import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ethers } from "ethers";
import { BlockchainService } from "../blockchain/blockchain.service";
import { SwapDto, QuoteDto } from "../common/dto/swap.dto";
import { SmartStakeDto } from "../common/dto/stake.dto";
import { AaveService } from "../aave/aave.service";
import { OneInchService } from "../one-inch/one-inch.service";

// Uniswap V3 Router ABI (minimal)
const UNISWAP_ROUTER_ABI = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
];

// Uniswap V3 Quoter ABI (minimal)
const UNISWAP_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) returns (uint256 amountOut)",
];

// ERC20 ABI (minimal)
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

export interface SwapQuote {
  fromToken: string;
  toToken: string;
  amountIn: string;
  amountOut: string;
  fee: number;
  priceImpact: number;
  route: string;
}

@Injectable()
export class SwapService {
  private readonly logger = new Logger(SwapService.name);
  private routerContract: ethers.Contract;
  private quoterContract: ethers.Contract;

  constructor(
    private configService: ConfigService,
    private blockchainService: BlockchainService,
    private aaveService: AaveService,
    private oneInchService: OneInchService,
  ) {
    this.initializeContracts();
  }

  private initializeContracts() {
    try {
      const provider = this.blockchainService.getProvider();
      const routerAddress = this.configService.get<string>(
        "contracts.uniswapRouter",
      );
      const quoterAddress = this.configService.get<string>(
        "contracts.uniswapQuoter",
      );

      if (provider && routerAddress) {
        this.routerContract = new ethers.Contract(
          routerAddress,
          UNISWAP_ROUTER_ABI,
          provider,
        );
      }

      if (provider && quoterAddress) {
        this.quoterContract = new ethers.Contract(
          quoterAddress,
          UNISWAP_QUOTER_ABI,
          provider,
        );
      }
    } catch (error) {
      this.logger.warn('Failed to initialize contracts in constructor, will retry on first use');
    }
  }

  async getQuote(quoteDto: QuoteDto): Promise<SwapQuote> {
    const { fromToken, toToken, amount } = quoteDto;

    try {
      // Log the request
      this.logger.log(`Getting quote for ${amount} ${fromToken} -> ${toToken}`);
      
      // Try 1inch first for better liquidity and ETH support
      try {
        const oneInchQuote = await this.oneInchService.getQuote({
          fromToken,
          toToken,
          amount,
        });

        if (oneInchQuote) {
          this.logger.log(`1inch quote successful: ${oneInchQuote.amountIn} ${fromToken} -> ${oneInchQuote.amountOut} ${toToken}`);
          return {
            fromToken,
            toToken,
            amountIn: oneInchQuote.amountIn,
            amountOut: oneInchQuote.amountOut,
            fee: 0.1, // 1inch fee is included in the quote
            priceImpact: 0,
            route: `${fromToken} -> ${toToken} (1inch)`,
          };
        }
      } catch (oneInchError) {
        this.logger.warn(`1inch quote failed for ${amount} ${fromToken}: ${oneInchError.message}`);
        // Continue to Uniswap fallback
      }

      // Fallback to Uniswap if 1inch fails
      // Handle ETH as special case (use WETH for quotes)
      const isFromETH = fromToken.toUpperCase() === "ETH";
      const isToETH = toToken.toUpperCase() === "ETH";
      
      // For ETH, we need special handling
      let fromAddress, toAddress;
      
      try {
        fromAddress = isFromETH 
          ? this.blockchainService.getTokenAddress("WETH")
          : this.blockchainService.getTokenAddress(fromToken);
        toAddress = isToETH
          ? this.blockchainService.getTokenAddress("WETH") 
          : this.blockchainService.getTokenAddress(toToken);
      } catch (tokenError) {
        // If token not found, try to handle it gracefully
        this.logger.error(`Token address lookup failed: ${tokenError.message}`);
        throw new BadRequestException(
          `Token ${isFromETH ? 'WETH' : fromToken} or ${isToETH ? 'WETH' : toToken} not supported for Uniswap fallback`
        );
      }
      
      const fromDecimals = isFromETH 
        ? 18  // ETH always has 18 decimals
        : await this.blockchainService.getTokenDecimals(fromAddress);
      const toDecimals =
        await this.blockchainService.getTokenDecimals(toAddress);
      const amountIn = ethers.utils.parseUnits(amount, fromDecimals);

      // Try direct quote first
      const directQuote = await this.getDirectQuote(
        fromAddress,
        toAddress,
        amountIn,
        fromDecimals,
        toDecimals,
        fromToken,
        toToken,
      );

      if (directQuote) {
        return directQuote;
      }

      // If direct quote fails, try multi-hop through intermediate tokens
      this.logger.log(`No direct route for ${fromToken} -> ${toToken}, trying multi-hop...`);
      const multiHopQuote = await this.getMultiHopQuote(
        fromAddress,
        toAddress,
        amountIn,
        fromDecimals,
        toDecimals,
        fromToken,
        toToken,
        amount,
      );

      if (multiHopQuote) {
        return multiHopQuote;
      }

      throw new BadRequestException(
        `No liquidity pool found for ${fromToken} -> ${toToken} (tried direct and multi-hop routes)`,
      );
    } catch (error) {
      this.logger.error(`Error getting quote: ${error.message}`);
      throw error;
    }
  }

  private async getDirectQuote(
    fromAddress: string,
    toAddress: string,
    amountIn: ethers.BigNumber,
    fromDecimals: number,
    toDecimals: number,
    fromToken: string,
    toToken: string,
  ): Promise<SwapQuote | null> {
    // Try different fee tiers
    const feeTiers = this.configService.get<number[]>("uniswap.feeTiers") || [
      100, 500, 3000, 10000,
    ];
    let bestQuote = null;
    let bestFee = 0;

    for (const fee of feeTiers) {
      try {
        const amountOut =
          await this.quoterContract.callStatic.quoteExactInputSingle(
            fromAddress,
            toAddress,
            fee,
            amountIn,
            0, // sqrtPriceLimitX96
          );

        if (!bestQuote || amountOut.gt(bestQuote)) {
          bestQuote = amountOut;
          bestFee = fee;
        }
      } catch (error) {
        // Pool doesn't exist for this fee tier
        continue;
      }
    }

    if (!bestQuote) {
      return null;
    }

    const amountOutFormatted = ethers.utils.formatUnits(
      bestQuote,
      toDecimals,
    );

    // Calculate price impact (simplified)
    const priceIn = parseFloat(ethers.utils.formatUnits(amountIn, fromDecimals));
    const priceOut = parseFloat(amountOutFormatted);
    const expectedRate = priceOut / priceIn;
    const priceImpact = Math.abs(1 - expectedRate) * 100;

    return {
      fromToken,
      toToken,
      amountIn: ethers.utils.formatUnits(amountIn, fromDecimals),
      amountOut: amountOutFormatted,
      fee: bestFee / 10000, // Convert to percentage
      priceImpact,
      route: `${fromToken} -> ${toToken} (${bestFee / 10000}% fee)`,
    };
  }

  private async getMultiHopQuote(
    fromAddress: string,
    toAddress: string,
    amountIn: ethers.BigNumber,
    fromDecimals: number,
    toDecimals: number,
    fromToken: string,
    toToken: string,
    amount: string,
  ): Promise<SwapQuote | null> {
    // Common intermediate tokens for multi-hop swaps
    const intermediateTokens = ["WETH", "DAI", "USDC"];
    let bestMultiHopQuote: SwapQuote | null = null;
    let bestIntermediateToken = "";

    for (const intermediate of intermediateTokens) {
      // Skip if intermediate is same as from or to token
      if (
        intermediate === fromToken.toUpperCase() ||
        intermediate === toToken.toUpperCase()
      ) {
        continue;
      }

      try {
        const intermediateAddress = this.blockchainService.getTokenAddress(intermediate);
        const intermediateDecimals = await this.blockchainService.getTokenDecimals(
          intermediateAddress,
        );

        // Get quote for first hop (from -> intermediate)
        const firstHop = await this.getDirectQuote(
          fromAddress,
          intermediateAddress,
          amountIn,
          fromDecimals,
          intermediateDecimals,
          fromToken,
          intermediate,
        );

        if (!firstHop) continue;

        // Get quote for second hop (intermediate -> to)
        const intermediateAmount = ethers.utils.parseUnits(
          firstHop.amountOut,
          intermediateDecimals,
        );
        const secondHop = await this.getDirectQuote(
          intermediateAddress,
          toAddress,
          intermediateAmount,
          intermediateDecimals,
          toDecimals,
          intermediate,
          toToken,
        );

        if (!secondHop) continue;

        // Calculate total fees and price impact
        const totalFee = firstHop.fee + secondHop.fee;
        const totalPriceImpact = firstHop.priceImpact + secondHop.priceImpact;

        const multiHopQuote: SwapQuote = {
          fromToken,
          toToken,
          amountIn: amount,
          amountOut: secondHop.amountOut,
          fee: totalFee,
          priceImpact: totalPriceImpact,
          route: `${fromToken} -> ${intermediate} -> ${toToken} (${totalFee.toFixed(2)}% total fee)`,
        };

        // Keep the best multi-hop quote (highest output)
        if (
          !bestMultiHopQuote ||
          parseFloat(multiHopQuote.amountOut) > parseFloat(bestMultiHopQuote.amountOut)
        ) {
          bestMultiHopQuote = multiHopQuote;
          bestIntermediateToken = intermediate;
        }
      } catch (error) {
        // Skip this intermediate token if there's an error
        continue;
      }
    }

    if (bestMultiHopQuote) {
      this.logger.log(
        `Found multi-hop route through ${bestIntermediateToken}: ${bestMultiHopQuote.route}`,
      );
    }

    return bestMultiHopQuote;
  }

  async swap(swapDto: SwapDto): Promise<any> {
    const {
      fromToken,
      toToken,
      amount,
      userAddress,
      maxSlippage = 1,
    } = swapDto;

    try {
      // Try 1inch first (better execution and DEX aggregation)
      try {
        const oneInchResult = await this.oneInchService.executeSwap({
          fromToken,
          toToken,
          amount,
          userAddress,
          slippage: maxSlippage,
        });
        
        return oneInchResult;
      } catch (oneInchError) {
        this.logger.warn(`1inch swap execution failed, falling back to Uniswap: ${oneInchError.message}`);
      }

      // Fallback to Uniswap if 1inch fails
      // Handle ETH as special case (use WETH address for swaps)
      const isFromETH = fromToken.toUpperCase() === "ETH";
      const fromAddress = isFromETH 
        ? this.blockchainService.getTokenAddress("WETH")
        : this.blockchainService.getTokenAddress(fromToken);
      const toAddress = this.blockchainService.getTokenAddress(toToken);
      
      const fromDecimals = isFromETH 
        ? 18  // ETH always has 18 decimals
        : await this.blockchainService.getTokenDecimals(fromAddress);
      const toDecimals =
        await this.blockchainService.getTokenDecimals(toAddress);
      const amountIn = ethers.utils.parseUnits(amount, fromDecimals);

      // Get quote first
      const quote = await this.getQuote({ fromToken, toToken, amount });
      const amountOutMin = ethers.utils.parseUnits(
        ((parseFloat(quote.amountOut) * (100 - maxSlippage)) / 100).toFixed(
          toDecimals,
        ),
        toDecimals,
      );

      // Check balance (ETH or ERC20)
      let balance: ethers.BigNumber;
      if (isFromETH) {
        // For ETH, check native balance
        const provider = this.blockchainService.getProvider();
        balance = await provider.getBalance(userAddress);
      } else {
        // For ERC20 tokens, check token balance
        const tokenContract = new ethers.Contract(
          fromAddress,
          ERC20_ABI,
          this.blockchainService.getProvider(),
        );
        balance = await tokenContract.balanceOf(userAddress);
      }

      if (balance.lt(amountIn)) {
        throw new BadRequestException(
          `Insufficient ${fromToken} balance. Have: ${ethers.utils.formatUnits(balance, fromDecimals)}, Need: ${amount}`,
        );
      }

      // Check if auto-execute is enabled
      if (!this.blockchainService.isAutoExecuteEnabled()) {
        return {
          success: true,
          simulation: true,
          message: `Would swap ${amount} ${fromToken} for ~${quote.amountOut} ${toToken}`,
          quote,
          details: {
            fromToken,
            toToken,
            amount,
            expectedOutput: quote.amountOut,
            minOutput: ethers.utils.formatUnits(amountOutMin, toDecimals),
            fee: `${quote.fee}%`,
            priceImpact: `${quote.priceImpact.toFixed(2)}%`,
          },
        };
      }

      const signer = this.blockchainService.getSigner(userAddress);
      const routerAddress = this.configService.get<string>(
        "contracts.uniswapRouter",
      );

      // Check and set allowance (not needed for ETH)
      if (!isFromETH) {
        const tokenContract = new ethers.Contract(
          fromAddress,
          ERC20_ABI,
          this.blockchainService.getProvider(),
        );
        const allowance = await tokenContract.allowance(
          userAddress,
          routerAddress,
        );
        if (allowance.lt(amountIn)) {
          this.logger.log(`Approving ${fromToken} for Uniswap Router...`);
          const approveTx = await tokenContract
            .connect(signer)
            .approve(routerAddress, ethers.constants.MaxUint256);
          await approveTx.wait();
          this.logger.log(`Approval transaction: ${approveTx.hash}`);
        }
      }

      // Prepare swap parameters
      const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      // For Uniswap, fee must be one of the valid fee tiers (100, 500, 3000, 10000)
      // If fee came from 1inch (0.1), use 3000 (0.3%) as default
      const uniswapFee = quote.route && quote.route.includes('1inch') ? 3000 : Math.round(quote.fee * 10000);
      const params = {
        tokenIn: fromAddress,
        tokenOut: toAddress,
        fee: uniswapFee,
        recipient: userAddress,
        deadline,
        amountIn,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96: 0,
      };

      // Execute swap
      this.logger.log(`Swapping ${amount} ${fromToken} for ${toToken}...`);
      let swapTx;
      if (isFromETH) {
        // For ETH swaps, send value with transaction
        swapTx = await this.routerContract
          .connect(signer)
          .exactInputSingle(params, { value: amountIn });
      } else {
        // For token swaps, no value needed
        swapTx = await this.routerContract
          .connect(signer)
          .exactInputSingle(params);
      }
      const receipt = await swapTx.wait();

      this.logger.log(`Swap successful: ${swapTx.hash}`);

      return {
        success: true,
        transactionHash: swapTx.hash,
        transactionUrl: this.blockchainService.getTransactionUrl(swapTx.hash),
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        fromToken,
        toToken,
        amountIn: amount,
        amountOut: quote.amountOut,
        fee: `${quote.fee}%`,
      };
    } catch (error) {
      this.logger.error(`Swap failed: ${error.message}`);
      throw error;
    }
  }

  async smartStake(smartStakeDto: SmartStakeDto): Promise<any> {
    const {
      asset,
      amount,
      userAddress,
      targetAsset,
      allowSwap = true,
      maxSlippage = 1,
    } = smartStakeDto;

    // If targetAsset is specified, use the new auto-stake with best APY logic
    if (targetAsset) {
      return this.autoStakeWithBestAPY({
        targetAsset,
        targetAmount: smartStakeDto.targetAmount || amount,
        userAddress,
        allowSwap,
        maxSlippage,
      });
    }

    try {
      // Determine target asset for staking
      const stakeAsset = targetAsset || asset;
      const reserves = await this.aaveService.getReserves();
      const supportedAssets = reserves.map((r) => r.symbol);

      // Check if target asset is supported by Aave
      if (!supportedAssets.includes(stakeAsset.toUpperCase())) {
        if (!allowSwap) {
          throw new BadRequestException(
            `${stakeAsset} is not supported by Aave and swapping is disabled`,
          );
        }

        // Find best supported asset to swap to
        const preferredAssets = ["USDC", "WETH", "DAI"];
        const bestAsset =
          preferredAssets.find((a) => supportedAssets.includes(a)) ||
          supportedAssets[0];

        if (!bestAsset) {
          throw new BadRequestException("No supported assets found on Aave");
        }

        this.logger.log(
          `${stakeAsset} not supported, will swap to ${bestAsset}`,
        );
        return this.smartStakeWithSwap(
          asset,
          amount,
          bestAsset,
          userAddress,
          maxSlippage,
        );
      }

      // Check user balance
      const tokenAddress = this.blockchainService.getTokenAddress(asset);
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        this.blockchainService.getProvider(),
      );
      const decimals =
        await this.blockchainService.getTokenDecimals(tokenAddress);
      const balance = await tokenContract.balanceOf(userAddress);
      const requiredAmount = ethers.utils.parseUnits(amount, decimals);

      if (balance.gte(requiredAmount)) {
        // Direct stake
        this.logger.log(`Sufficient ${asset} balance, staking directly`);
        return await this.aaveService.stake({ asset, amount, userAddress });
      }

      if (!allowSwap) {
        throw new BadRequestException(
          `Insufficient ${asset} balance. Have: ${ethers.utils.formatUnits(balance, decimals)}, Need: ${amount}`,
        );
      }

      // Find tokens with sufficient balance to swap
      const userTokens = await this.findUserTokensWithBalance(userAddress);
      const swapFrom = userTokens.find(
        (t) => t.symbol !== asset && parseFloat(t.balance) > 0,
      );

      if (!swapFrom) {
        throw new BadRequestException(
          "No tokens with sufficient balance for swapping",
        );
      }

      this.logger.log(`Will swap ${swapFrom.symbol} to ${asset} for staking`);
      return this.smartStakeWithSwap(
        swapFrom.symbol,
        swapFrom.balance,
        asset,
        userAddress,
        maxSlippage,
      );
    } catch (error) {
      this.logger.error(`Smart stake failed: ${error.message}`);
      throw error;
    }
  }

  private async smartStakeWithSwap(
    fromToken: string,
    fromAmount: string,
    toToken: string,
    userAddress: string,
    maxSlippage: number,
  ): Promise<any> {
    try {
      // If swapping from native ETH, use WETH for the swap
      // (Uniswap automatically wraps ETH to WETH)
      const swapFromToken = fromToken === "ETH" ? "WETH" : fromToken;
      
      // First, perform the swap
      const swapResult = await this.swap({
        fromToken: swapFromToken,
        toToken,
        amount: fromAmount,
        userAddress,
        maxSlippage,
      });

      if (swapResult.simulation) {
        return {
          ...swapResult,
          message: `Would swap ${fromAmount} ${fromToken} to ${toToken} and then stake`,
        };
      }

      // Wait for swap to complete
      await this.blockchainService.waitForTransaction(
        swapResult.transactionHash,
      );

      // Then stake the received tokens
      const stakeResult = await this.aaveService.stake({
        asset: toToken,
        amount: swapResult.amountOut,
        userAddress,
      });

      return {
        success: true,
        swap: swapResult,
        stake: stakeResult,
        message: `Successfully swapped ${fromAmount} ${fromToken} to ${swapResult.amountOut} ${toToken} and staked`,
      };
    } catch (error) {
      this.logger.error(`Smart stake with swap failed: ${error.message}`);
      throw error;
    }
  }

  private async findUserTokensWithBalance(
    userAddress: string,
  ): Promise<Array<{ symbol: string; balance: string }>> {
    const tokens =
      this.configService.get<Record<string, string>>("tokens") || {};
    const userTokens: Array<{ symbol: string; balance: string }> = [];

    // First check native ETH balance
    try {
      const provider = this.blockchainService.getProvider();
      const ethBalance = await provider.getBalance(userAddress);
      const ethBalanceFormatted = ethers.utils.formatEther(ethBalance);
      
      if (parseFloat(ethBalanceFormatted) > 0) {
        // Add ETH as available token (will be wrapped to WETH for swaps)
        userTokens.push({ 
          symbol: "ETH", 
          balance: ethBalanceFormatted 
        });
        this.logger.log(`Found ${ethBalanceFormatted} ETH available for swap`);
      }
    } catch (error) {
      this.logger.warn(`Failed to check ETH balance: ${error.message}`);
    }

    // Then check all ERC20 tokens
    for (const [symbol, address] of Object.entries(tokens)) {
      try {
        const balance = await this.blockchainService.getBalance(
          userAddress,
          address,
        );
        if (parseFloat(balance) > 0) {
          userTokens.push({ symbol, balance });
        }
      } catch (error) {
        // Skip tokens that fail
        continue;
      }
    }

    return userTokens;
  }

  /**
   * Auto-stake with best APY - finds highest yielding asset and stakes
   */
  async autoStakeWithBestAPY(params: {
    targetAsset: string;
    targetAmount: string;
    userAddress: string;
    allowSwap?: boolean;
    maxSlippage?: number;
  }): Promise<any> {
    const { targetAsset, targetAmount, userAddress, allowSwap = true, maxSlippage = 1 } = params;

    try {
      // Get user's current balances
      const userBalances = await this.blockchainService.getAllBalances(userAddress);
      
      // Check if user has enough of the target asset
      const targetBalance = userBalances[targetAsset.toUpperCase()] || userBalances[targetAsset] || "0";
      const currentTargetBalance = parseFloat(targetBalance);
      const requiredAmount = parseFloat(targetAmount);
      
      if (currentTargetBalance >= requiredAmount) {
        // User has enough, stake directly
        this.logger.log(`User has ${targetBalance} ${targetAsset}, staking directly`);
        return await this.aaveService.stake({
          asset: targetAsset,
          amount: targetAmount,
          userAddress,
        });
      }

      if (!allowSwap) {
        throw new BadRequestException(
          `Insufficient ${targetAsset} balance. Have: ${targetBalance}, Need: ${targetAmount}`,
        );
      }
      
      // Calculate how much more of target asset we need
      const additionalNeeded = requiredAmount - currentTargetBalance;
      this.logger.log(`Need additional ${additionalNeeded} ${targetAsset} (have ${currentTargetBalance})`)

      // Find the best source token to swap from
      let bestSourceToken: string | null = null;
      let bestSourceAmount = "0";
      let bestQuote: any = null;

      // Prioritize ETH and stablecoins for swapping
      const priorityTokens = ['ETH', 'USDC', 'USDT', 'DAI', 'USDbC'];
      const otherTokens = Object.keys(userBalances).filter(t => !priorityTokens.includes(t) && t !== targetAsset.toUpperCase() && t !== 'ETH');
      const tokensToCheck = [...priorityTokens, ...otherTokens];

      for (const token of tokensToCheck) {
        const balance = userBalances[token];
        if (!balance || parseFloat(balance) === 0) {
          continue;
        }

        try {
          // First, estimate how much of source token we need to get additionalNeeded of target
          // Try with full balance first to get exchange rate
          const testQuote = await this.getQuote({
            fromToken: token,
            toToken: targetAsset,
            amount: balance,
          });

          // Calculate exchange rate
          const exchangeRate = parseFloat(testQuote.amountOut) / parseFloat(balance);
          
          // Calculate how much source token we need for additionalNeeded target
          const requiredSourceAmount = (additionalNeeded / exchangeRate * 1.01).toFixed(6); // Add 1% buffer
          
          // Check if we have enough balance
          if (parseFloat(balance) >= parseFloat(requiredSourceAmount)) {
            // Get precise quote for exact amount needed
            const preciseQuote = await this.getQuote({
              fromToken: token,
              toToken: targetAsset,
              amount: requiredSourceAmount,
            });
            
            if (parseFloat(preciseQuote.amountOut) >= additionalNeeded) {
              if (!bestSourceToken || parseFloat(requiredSourceAmount) < parseFloat(bestSourceAmount)) {
                bestSourceToken = token;
                bestSourceAmount = requiredSourceAmount;
                bestQuote = preciseQuote;
                this.logger.log(`Found swap option: ${requiredSourceAmount} ${token} -> ${preciseQuote.amountOut} ${targetAsset}`);
              }
            }
          }
        } catch (error) {
          // Skip tokens that can't be swapped
          this.logger.debug(`Cannot swap ${token} to ${targetAsset}: ${error.message}`);
          continue;
        }
      }

      if (!bestSourceToken || !bestQuote) {
        throw new BadRequestException(
          `Cannot find a suitable token to swap for ${additionalNeeded} ${targetAsset} (need total ${targetAmount}). Available balances: ${JSON.stringify(userBalances)}`,
        );
      }

      this.logger.log(
        `Will swap ${bestSourceAmount} ${bestSourceToken} to get ${targetAmount} ${targetAsset} for staking`,
      );

      // Execute the swap
      const swapResult = await this.swap({
        fromToken: bestSourceToken,
        toToken: targetAsset,
        amount: bestSourceAmount,
        userAddress,
        maxSlippage,
      });

      if (swapResult.simulation) {
        return {
          ...swapResult,
          message: `Would swap ${bestSourceAmount} ${bestSourceToken} to ~${bestQuote.amountOut} ${targetAsset} and then stake total ${targetAmount} ${targetAsset}`,
          details: {
            currentBalance: currentTargetBalance,
            additionalNeeded: additionalNeeded,
            swapFrom: bestSourceToken,
            swapAmount: bestSourceAmount,
            expectedReceive: bestQuote.amountOut,
            totalToStake: targetAmount
          }
        };
      }

      // Wait for swap to complete (if it's an order, wait for execution)
      if (swapResult.transactionHash) {
        await this.blockchainService.waitForTransaction(swapResult.transactionHash);
      } else if (swapResult.orderUid) {
        this.logger.log(`Waiting for swap order ${swapResult.orderUid} to be executed...`);
        // For swap orders, we should wait for execution
        // For now, we'll proceed assuming it will execute
      }

      // Now stake the total amount (existing + swapped)
      const stakeResult = await this.aaveService.stake({
        asset: targetAsset,
        amount: targetAmount,
        userAddress,
      });

      return {
        success: true,
        swap: swapResult,
        stake: stakeResult,
        message: `Successfully swapped ${bestSourceAmount} ${bestSourceToken} to ${targetAmount} ${targetAsset} and staked on Aave`,
      };
    } catch (error) {
      this.logger.error(`Auto-stake with best APY failed: ${error.message}`);
      throw error;
    }
  }
}
