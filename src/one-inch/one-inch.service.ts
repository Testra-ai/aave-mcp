import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import axios, { AxiosInstance } from 'axios';
import { BlockchainService } from '../blockchain/blockchain.service';

export interface OneInchQuote {
  fromToken: string;
  toToken: string;
  amountIn: string;
  amountOut: string;
  estimatedGas: string;
  protocols: any[];
  tx?: any;
}

@Injectable()
export class OneInchService {
  private readonly logger = new Logger(OneInchService.name);
  private readonly chainId = 8453; // Base
  private readonly apiClient: AxiosInstance;
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(
    private configService: ConfigService,
    private blockchainService: BlockchainService,
  ) {
    // Fix URL format - remove trailing slash from config
    const baseUrl = this.configService.get<string>('ONE_INCH_API_URL') || 'https://api.1inch.dev';
    this.apiUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    this.apiUrl = `${this.apiUrl}/swap/v6.0`;
    this.apiKey = this.configService.get<string>('ONE_INCH_API_KEY') || '';
    
    if (!this.apiKey) {
      this.logger.warn('1inch API key not configured. Some features may not work.');
    }

    this.apiClient = axios.create({
      baseURL: `${this.apiUrl}/${this.chainId}`,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 30000,
    });

    this.logger.log('1inch service initialized for Base network');
  }

  /**
   * Get swap quote from 1inch
   */
  async getQuote(params: {
    fromToken: string;
    toToken: string;
    amount: string;
    userAddress?: string;
  }): Promise<OneInchQuote> {
    try {
      const { fromToken, toToken, amount, userAddress } = params;
      
      // Get token addresses
      // Handle ETH specially - 1inch uses a placeholder address for native ETH
      const fromAddress = fromToken.toUpperCase() === 'ETH' 
        ? '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' // 1inch uses this for ETH
        : this.blockchainService.getTokenAddress(fromToken);
      const toAddress = toToken.toUpperCase() === 'ETH'
        ? '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
        : this.blockchainService.getTokenAddress(toToken);

      // Get decimals
      const fromDecimals = fromToken.toUpperCase() === 'ETH' 
        ? 18 
        : await this.blockchainService.getTokenDecimals(fromAddress);

      // Convert amount to wei
      const amountWei = ethers.utils.parseUnits(amount, fromDecimals).toString();

      this.logger.log(`Getting 1inch quote for ${amount} ${fromToken} -> ${toToken}`);

      // Call 1inch quote API
      const response = await this.apiClient.get('/quote', {
        params: {
          src: fromAddress,
          dst: toAddress,
          amount: amountWei,
          from: userAddress || this.blockchainService.getWalletAddress(),
          slippage: 1, // 1% slippage
        }
      });

      const data = response.data;
      
      // Format the response
      const toDecimals = toToken.toUpperCase() === 'ETH'
        ? 18
        : await this.blockchainService.getTokenDecimals(toAddress);
      
      const amountOutFormatted = ethers.utils.formatUnits(data.dstAmount, toDecimals);

      this.logger.log(`Quote received: ${amount} ${fromToken} -> ${amountOutFormatted} ${toToken}`);

      return {
        fromToken,
        toToken,
        amountIn: amount,
        amountOut: amountOutFormatted,
        estimatedGas: data.gas || '0',
        protocols: data.protocols || [],
      };
    } catch (error) {
      this.logger.error(`Error getting 1inch quote: ${error.message}`);
      if (error.response?.data?.description) {
        throw new BadRequestException(error.response.data.description);
      }
      throw error;
    }
  }

  /**
   * Execute swap through 1inch
   */
  async executeSwap(params: {
    fromToken: string;
    toToken: string;
    amount: string;
    userAddress: string;
    slippage?: number;
  }): Promise<any> {
    try {
      const { fromToken, toToken, amount, userAddress, slippage = 1 } = params;

      // Get token addresses
      const fromAddress = fromToken.toUpperCase() === 'ETH' 
        ? '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
        : this.blockchainService.getTokenAddress(fromToken);
      const toAddress = toToken.toUpperCase() === 'ETH'
        ? '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
        : this.blockchainService.getTokenAddress(toToken);

      // Get decimals
      const fromDecimals = fromToken.toUpperCase() === 'ETH' 
        ? 18 
        : await this.blockchainService.getTokenDecimals(fromAddress);

      // Convert amount to wei
      const amountWei = ethers.utils.parseUnits(amount, fromDecimals).toString();

      // Check if auto-execute is enabled
      if (!this.blockchainService.isAutoExecuteEnabled()) {
        // Just get quote for simulation
        const quote = await this.getQuote({ fromToken, toToken, amount, userAddress });
        return {
          success: true,
          simulation: true,
          message: `Would swap ${amount} ${fromToken} for ~${quote.amountOut} ${toToken} via 1inch`,
          quote: {
            ...quote,
            protocol: '1inch',
          },
        };
      }

      // Get wallet/signer  
      const wallet = this.blockchainService.getWallet();
      if (!wallet) {
        throw new BadRequestException('No wallet configured for auto-execution');
      }

      // Use server wallet address as 'from' since we're signing with it
      const fromWallet = wallet.address;

      this.logger.log(`Getting 1inch swap data for ${amount} ${fromToken} -> ${toToken}`);

      // Call 1inch swap API to get transaction data
      const response = await this.apiClient.get('/swap', {
        params: {
          src: fromAddress,
          dst: toAddress,
          amount: amountWei,
          from: fromWallet, // Server wallet executes the swap
          receiver: userAddress, // User receives the tokens
          slippage: slippage,
          disableEstimate: false, // Enable gas estimation
          allowPartialFill: false,
        }
      });

      const swapData = response.data;

      // Check and approve tokens if needed (not needed for ETH)
      if (fromToken.toUpperCase() !== 'ETH' && fromAddress !== '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE') {
        await this.ensureApproval(
          fromAddress,
          amountWei,
          swapData.tx.to, // 1inch router address
          fromWallet // Use server wallet for approval
        );
      }

      // Execute the swap transaction
      this.logger.log(`Executing 1inch swap: ${amount} ${fromToken} -> ${toToken}`);
      
      const tx = {
        to: swapData.tx.to,
        data: swapData.tx.data,
        value: swapData.tx.value || '0x0',
        gasLimit: ethers.BigNumber.from(swapData.tx.gas).mul(120).div(100), // Add 20% buffer
      };

      const signer = this.blockchainService.getSigner(fromWallet);
      const transaction = await signer.sendTransaction(tx);
      const receipt = await transaction.wait();

      this.logger.log(`Swap successful: ${transaction.hash}`);

      // Format output amount
      const toDecimals = toToken.toUpperCase() === 'ETH'
        ? 18
        : await this.blockchainService.getTokenDecimals(toAddress);
      const amountOutFormatted = ethers.utils.formatUnits(swapData.dstAmount, toDecimals);

      return {
        success: true,
        transactionHash: transaction.hash,
        transactionUrl: this.blockchainService.getTransactionUrl(transaction.hash),
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        fromToken,
        toToken,
        amountIn: amount,
        amountOut: amountOutFormatted,
        protocol: '1inch',
        route: swapData.protocols?.map(p => p[0]?.name).join(' -> ') || 'Direct',
      };
    } catch (error) {
      this.logger.error(`1inch swap execution failed: ${error.message}`);
      if (error.response?.data) {
        this.logger.error(`1inch API error: ${JSON.stringify(error.response.data)}`);
        throw new BadRequestException(error.response.data.description || error.response.data.error || 'Swap failed');
      }
      throw error;
    }
  }

  /**
   * Ensure token approval for 1inch router
   */
  private async ensureApproval(
    tokenAddress: string,
    amount: string,
    spender: string,
    walletAddress: string
  ): Promise<void> {
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ['function approve(address spender, uint256 amount) returns (bool)',
       'function allowance(address owner, address spender) view returns (uint256)'],
      this.blockchainService.getProvider()
    );

    const currentAllowance = await tokenContract.allowance(walletAddress, spender);
    
    if (currentAllowance.lt(amount)) {
      this.logger.log(`Approving ${tokenAddress} for 1inch Router...`);
      // Use server wallet for signing approval
      const wallet = this.blockchainService.getWallet();
      if (!wallet) {
        throw new Error('No wallet configured for approval');
      }
      const approveTx = await tokenContract.connect(wallet).approve(
        spender,
        ethers.constants.MaxUint256
      );
      await approveTx.wait();
      this.logger.log(`Approval transaction: ${approveTx.hash}`);
    } else {
      this.logger.log('Token already approved for 1inch');
    }
  }

  /**
   * Get supported tokens on 1inch
   */
  async getSupportedTokens(): Promise<any> {
    try {
      const response = await this.apiClient.get('/tokens');
      return response.data.tokens;
    } catch (error) {
      this.logger.error(`Failed to get supported tokens: ${error.message}`);
      throw error;
    }
  }
}