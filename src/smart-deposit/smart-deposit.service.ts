import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { BlockchainService } from '../blockchain/blockchain.service';
import { SwapService } from '../swap/swap.service';
import { AaveService } from '../aave/aave.service';
import { ConfigService } from '@nestjs/config';

export interface SmartDepositParams {
  targetAmount: string; // Amount in USD to deposit
  targetAsset?: string; // Asset to deposit (default USDC)
  userAddress?: string; // Override wallet address
  maxSlippage?: number; // Max slippage for swap (default 1%)
}

export interface SmartDepositResult {
  success: boolean;
  deposited?: string;
  asset?: string;
  swapped?: boolean;
  swapDetails?: any;
  transactionHash?: string;
  error?: string;
}

@Injectable()
export class SmartDepositService {
  private readonly logger = new Logger(SmartDepositService.name);
  
  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly swapService: SwapService,
    private readonly aaveService: AaveService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Smart deposit with automatic source detection and swap
   */
  async smartDeposit(params: SmartDepositParams): Promise<SmartDepositResult> {
    const {
      targetAmount,
      targetAsset = 'USDC',
      userAddress = this.blockchainService.getWalletAddress(),
      maxSlippage = 1,
    } = params;

    this.logger.log(`Smart deposit: ${targetAmount} ${targetAsset} for ${userAddress}`);

    try {
      // Get wallet if available
      const wallet = this.blockchainService.getWallet();
      const autoExecute = this.configService.get('AUTO_EXECUTE') === 'true';

      if (!autoExecute || !wallet) {
        return {
          success: false,
          error: 'Auto-execute disabled or wallet not configured',
        };
      }

      // Check balances
      const balances = await this.checkAllBalances(userAddress);
      this.logger.log(`Balances: ${JSON.stringify(balances)}`);

      // Check if we have enough target asset
      const targetBalance = balances[targetAsset] || 0;
      const targetAmountNum = parseFloat(targetAmount);

      if (targetBalance >= targetAmountNum) {
        // Direct deposit
        this.logger.log(`Direct deposit: sufficient ${targetAsset} balance`);
        return await this.directDeposit(targetAsset, targetAmount, userAddress);
      }

      // Find best source for swap
      const sourceAsset = await this.findBestSourceAsset(
        balances,
        targetAsset,
        targetAmountNum,
      );

      if (!sourceAsset) {
        return {
          success: false,
          error: 'Insufficient balance in any supported asset',
        };
      }

      this.logger.log(`Will swap ${sourceAsset.asset} to ${targetAsset}`);

      // Execute swap
      const swapResult = await this.executeSmartSwap(
        sourceAsset,
        targetAsset,
        targetAmountNum,
        userAddress,
        maxSlippage,
      );

      if (!swapResult.success) {
        return {
          success: false,
          error: `Swap failed: ${swapResult.error}`,
        };
      }

      // Deposit after swap
      const depositResult = await this.directDeposit(
        targetAsset,
        targetAmount,
        userAddress,
      );

      return {
        ...depositResult,
        swapped: true,
        swapDetails: swapResult,
      };

    } catch (error) {
      this.logger.error('Smart deposit failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Check all token balances including ETH
   */
  private async checkAllBalances(address: string): Promise<Record<string, number>> {
    const balances: Record<string, number> = {};
    
    // Check ETH balance
    const provider = this.blockchainService.getProvider();
    const ethBalanceBN = await provider.getBalance(address);
    balances['ETH'] = parseFloat(ethers.utils.formatEther(ethBalanceBN));

    // Check token balances
    const tokens = ['USDC', 'USDbC', 'USDT', 'DAI', 'GHO', 'EURC', 'WETH', 'cbETH', 'wstETH', 'weETH', 'ezETH', 'wrsETH', 'cbBTC', 'LBTC', 'AAVE'];
    for (const token of tokens) {
      try {
        const balance = await this.blockchainService.getTokenBalance(address, token);
        const tokenAddress = this.blockchainService.getTokenAddress(token);
        const decimals = await this.blockchainService.getTokenDecimals(tokenAddress);
        balances[token] = parseFloat(ethers.utils.formatUnits(balance, decimals));
      } catch (error) {
        this.logger.debug(`Failed to get ${token} balance: ${error.message}`);
        balances[token] = 0;
      }
    }

    return balances;
  }

  /**
   * Find best source asset for swap based on balance and liquidity
   */
  private async findBestSourceAsset(
    balances: Record<string, number>,
    targetAsset: string,
    targetAmount: number,
  ): Promise<{ asset: string; amount: string } | null> {
    const candidates: any[] = [];

    // Check each asset with sufficient balance
    for (const [asset, balance] of Object.entries(balances)) {
      if (asset === targetAsset || balance <= 0) continue;

      // For ETH, leave some for gas
      const availableBalance = asset === 'ETH' 
        ? Math.max(0, balance - 0.01) // Keep 0.01 ETH for gas
        : balance;

      if (availableBalance <= 0) continue;

      try {
        // Get swap quote to check if we can get target amount
        const quote = await this.swapService.getQuote({
          fromToken: asset === 'ETH' ? 'WETH' : asset,
          toToken: targetAsset,
          amount: targetAmount.toString(),
        });

        if (quote && parseFloat(quote.amountIn) <= availableBalance) {
          candidates.push({
            asset,
            amount: quote.amountIn,
            fee: quote.fee || 0,
            impact: quote.priceImpact || 0,
          });
        }
      } catch (error) {
        this.logger.debug(`Quote failed for ${asset}->${targetAsset}: ${error.message}`);
      }
    }

    if (candidates.length === 0) return null;

    // Sort by best option (lowest amount needed)
    candidates.sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount));

    const best = candidates[0];
    return {
      asset: best.asset,
      amount: best.amount,
    };
  }

  /**
   * Execute smart swap with ETH handling
   */
  private async executeSmartSwap(
    source: { asset: string; amount: string },
    targetAsset: string,
    targetAmount: number,
    userAddress: string,
    maxSlippage: number,
  ): Promise<any> {
    try {
      // Handle ETH -> need to wrap first or use direct swap
      if (source.asset === 'ETH') {
        return await this.swapService.swap({
          fromToken: 'WETH', // Uniswap uses WETH
          toToken: targetAsset,
          amount: targetAmount.toString(),
          userAddress: userAddress,
        });
      }

      // Regular token swap
      return await this.swapService.swap({
        fromToken: source.asset,
        toToken: targetAsset,
        amount: targetAmount.toString(),
        userAddress: userAddress,
      });
    } catch (error) {
      this.logger.error('Swap execution failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Direct deposit to Aave
   */
  private async directDeposit(
    asset: string,
    amount: string,
    userAddress: string,
  ): Promise<SmartDepositResult> {
    try {
      const result = await this.aaveService.stake({
        asset,
        amount,
        userAddress,
      });

      return {
        success: result.success || false,
        deposited: amount,
        asset,
        transactionHash: result.transactionHash,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get best APY asset on Aave
   */
  async getBestApyAsset(): Promise<{ asset: string; apy: number }> {
    const strategies = await this.aaveService.getBestStrategies();
    
    if (!strategies || strategies.length === 0) {
      return { asset: 'USDC', apy: 0 };
    }

    // Sort by APY
    strategies.sort((a, b) => b.apy - a.apy);
    
    return {
      asset: strategies[0].asset,
      apy: strategies[0].apy,
    };
  }
}