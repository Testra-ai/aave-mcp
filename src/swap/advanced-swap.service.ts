import { Injectable, Logger } from "@nestjs/common";
import { ethers } from "ethers";
import { BlockchainService } from "../blockchain/blockchain.service";
import { OneInchService } from "../one-inch/one-inch.service";
import { AaveService } from "../aave/aave.service";
import { SwapService } from "./swap.service";

@Injectable()
export class AdvancedSwapService {
  private readonly logger = new Logger(AdvancedSwapService.name);

  constructor(
    private blockchainService: BlockchainService,
    private oneInchService: OneInchService,
    private aaveService: AaveService,
    private swapService: SwapService,
  ) {}

  /**
   * Smart stake with automatic multi-step swaps
   * Example: User wants to stake 10 USDC in GHO strategy but only has 8.5 USDC
   * 1. Check if user has enough source token (USDC)
   * 2. If not, swap ETH to cover the difference
   * 3. Swap source token to target token (USDC -> GHO)
   * 4. Stake target token on Aave
   */
  async smartStakeWithAutoFunding(params: {
    sourceToken: string;      // Token user wants to use (e.g., USDC)
    targetToken: string;      // Token to stake (e.g., GHO)
    sourceAmount: string;     // Amount of source token to use
    userAddress: string;
    useEthForShortfall?: boolean;  // Use ETH to cover any shortfall
  }): Promise<any> {
    const { 
      sourceToken, 
      targetToken, 
      sourceAmount, 
      userAddress, 
      useEthForShortfall = true 
    } = params;

    try {
      this.logger.log(`Smart stake request: ${sourceAmount} ${sourceToken} -> ${targetToken}`);
      
      // Step 1: Check user balances
      const balances = await this.blockchainService.getAllBalances(userAddress);
      const sourceBalance = parseFloat(balances[sourceToken] || balances[sourceToken.toUpperCase()] || "0");
      const ethBalance = parseFloat(balances.ETH || "0");
      const requiredAmount = parseFloat(sourceAmount);
      
      this.logger.log(`User balances: ${sourceToken}: ${sourceBalance}, ETH: ${ethBalance}`);
      
      // Variables for ETH swap if needed
      let ethSwapResult: any = null;
      let ethNeeded = "0";
      
      // Step 2: Check if we need to fund the difference
      if (sourceBalance < requiredAmount) {
        const shortfall = requiredAmount - sourceBalance;
        this.logger.log(`Shortfall detected: need ${shortfall} more ${sourceToken}`);
        
        if (!useEthForShortfall || ethBalance < 0.001) {
          return {
            success: false,
            error: `Insufficient ${sourceToken} balance. Have: ${sourceBalance}, Need: ${requiredAmount}, Shortfall: ${shortfall}`,
            suggestion: ethBalance > 0.001 ? 
              `You can use your ETH balance (${ethBalance} ETH) to cover the shortfall` : 
              `Not enough ETH to cover shortfall`
          };
        }
        
        // Step 2a: Get quote for ETH -> sourceToken to cover shortfall
        this.logger.log(`Getting quote for ETH -> ${sourceToken} to cover ${shortfall} ${sourceToken} shortfall`);
        
        // Use 1inch for ETH swaps since it handles native ETH well
        // First, estimate how much ETH we need
        let ethToSourceRate = 0;
        
        try {
          // Try to get rate from Uniswap for ETH->sourceToken
          const uniswapQuote = await this.swapService.getQuote({
            fromToken: "ETH",
            toToken: sourceToken,
            amount: "0.01", // Test with 0.01 ETH
          });
          ethToSourceRate = parseFloat(uniswapQuote.amountOut) / 0.01;
        } catch (error) {
          // If direct swap fails, estimate based on typical rates
          // ETH ~$3000, USDC = $1, so 1 ETH ≈ 3000 USDC
          if (sourceToken.toUpperCase() === 'USDC' || sourceToken.toUpperCase() === 'USDT') {
            ethToSourceRate = 3000; // Rough estimate
          } else {
            throw new Error(`Cannot estimate ETH to ${sourceToken} rate`);
          }
        }
        
        ethNeeded = (shortfall / ethToSourceRate * 1.05).toFixed(6); // Add 5% buffer
        
        if (parseFloat(ethNeeded) > ethBalance) {
          return {
            success: false,
            error: `Not enough ETH to cover shortfall. Need ~${ethNeeded} ETH but have ${ethBalance} ETH`,
          };
        }
        
        // Get precise quote using Uniswap for ETH swaps
        let ethSwapQuote;
        try {
          ethSwapQuote = await this.swapService.getQuote({
            fromToken: "ETH",
            toToken: sourceToken,
            amount: ethNeeded,
          });
        } catch (error) {
          // If Uniswap fails, calculate estimate
          ethSwapQuote = {
            amountOut: (parseFloat(ethNeeded) * ethToSourceRate * 0.98).toFixed(6), // 2% slippage
            fromToken: "ETH",
            toToken: sourceToken,
            amountIn: ethNeeded,
          };
        }
        
        this.logger.log(`Quote: ${ethNeeded} ETH -> ${ethSwapQuote.amountOut} ${sourceToken}`);
        
        // Check if auto-execute is enabled
        if (!this.blockchainService.isAutoExecuteEnabled()) {
          return {
            success: true,
            simulation: true,
            message: `Multi-step operation planned`,
            steps: [
              {
                step: 1,
                action: "Swap ETH to cover shortfall",
                details: `Swap ${ethNeeded} ETH -> ~${ethSwapQuote.amountOut} ${sourceToken}`,
              },
              {
                step: 2,
                action: "Swap to target token",
                details: `Swap ${sourceAmount} ${sourceToken} -> ${targetToken}`,
              },
              {
                step: 3,
                action: "Stake on Aave",
                details: `Stake ${targetToken} on Aave V3`,
              }
            ]
          };
        }
        
        // Step 2b: Execute ETH -> sourceToken swap using Uniswap
        this.logger.log(`Executing swap via Uniswap: ${ethNeeded} ETH -> ${sourceToken}`);
        
        try {
          // Use Uniswap for ETH swaps
          ethSwapResult = await this.swapService.swap({
            fromToken: "ETH",
            toToken: sourceToken,
            amount: ethNeeded,
            userAddress,
            maxSlippage: 2,
          });
        } catch (swapError) {
          this.logger.error(`Uniswap swap failed: ${swapError.message}`);
          
          // Fallback: Try wrapping ETH to WETH first, then use 1inch
          this.logger.log('Trying alternative: ETH -> WETH -> ' + sourceToken);
          
          // This would require WETH wrapping contract interaction
          // For now, return error with suggestion
          return {
            success: false,
            error: `ETH swap failed. Please manually swap ${ethNeeded} ETH to ${sourceToken} first.`,
            suggestion: `You need ${shortfall} more ${sourceToken}. Try swapping ${ethNeeded} ETH manually.`
          };
        }
        
        if (ethSwapResult.transactionHash) {
          this.logger.log(`ETH swap transaction: ${ethSwapResult.transactionHash}`);
          // Wait for transaction confirmation
          await this.blockchainService.waitForTransaction(ethSwapResult.transactionHash, 1);
          this.logger.log('ETH swap confirmed, proceeding with main swap');
        } else if (ethSwapResult.simulation) {
          this.logger.log('ETH swap is in simulation mode');
        }
      }
      
      // Step 3: Now swap sourceToken -> targetToken (use 1inch for better rates)
      this.logger.log(`Getting quote for ${sourceAmount} ${sourceToken} -> ${targetToken}`);
      
      let mainSwapQuote;
      let use1inch = true;
      
      try {
        // Try 1inch first (better rates, DEX aggregation)
        mainSwapQuote = await this.oneInchService.getQuote({
          fromToken: sourceToken,
          toToken: targetToken,
          amount: sourceAmount,
          userAddress,
        });
        this.logger.log(`1inch quote: ${sourceAmount} ${sourceToken} -> ${mainSwapQuote.amountOut} ${targetToken}`);
      } catch (oneInchError) {
        this.logger.warn(`1inch quote failed: ${oneInchError.message}, trying Uniswap`);
        use1inch = false;
        
        // Fallback to Uniswap
        mainSwapQuote = await this.swapService.getQuote({
          fromToken: sourceToken,
          toToken: targetToken,
          amount: sourceAmount,
        });
        this.logger.log(`Uniswap quote: ${sourceAmount} ${sourceToken} -> ${mainSwapQuote.amountOut} ${targetToken}`);
      }
      
      // Execute main swap
      this.logger.log(`Executing main swap via ${use1inch ? '1inch' : 'Uniswap'}: ${sourceAmount} ${sourceToken} -> ${targetToken}`);
      
      let mainSwapResult;
      if (use1inch) {
        mainSwapResult = await this.oneInchService.executeSwap({
          fromToken: sourceToken,
          toToken: targetToken,
          amount: sourceAmount,
          userAddress,
          slippage: 1,
        });
      } else {
        mainSwapResult = await this.swapService.swap({
          fromToken: sourceToken,
          toToken: targetToken,
          amount: sourceAmount,
          userAddress,
          maxSlippage: 1,
        });
      }
      
      if (mainSwapResult.orderUid) {
        this.logger.log(`Main swap order created: ${mainSwapResult.orderUid}`);
        // Wait for execution
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
      
      // Step 4: Stake the target token
      this.logger.log(`Staking ${mainSwapQuote.amountOut} ${targetToken} on Aave`);
      const stakeResult = await this.aaveService.stake({
        asset: targetToken,
        amount: mainSwapQuote.amountOut,
        userAddress,
      });
      
      return {
        success: true,
        message: `Successfully completed multi-step stake operation`,
        ethSwap: ethSwapResult,
        mainSwap: mainSwapResult,
        stake: stakeResult,
        summary: {
          ethUsed: ethNeeded,
          sourceTokenUsed: sourceAmount,
          targetTokenReceived: mainSwapQuote.amountOut,
          stakedAmount: mainSwapQuote.amountOut,
        }
      };
      
    } catch (error) {
      this.logger.error(`Smart stake with auto funding failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}