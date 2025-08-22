import { Injectable, Logger } from "@nestjs/common";
import { AaveService } from "../aave/aave.service";
import { SwapService } from "../swap/swap.service";
import { AdvancedSwapService } from "../swap/advanced-swap.service";
import { BlockchainService } from "../blockchain/blockchain.service";
import { SmartDepositService } from "../smart-deposit/smart-deposit.service";
import { TransactionBuilderService } from "../transaction-builder/transaction-builder.service";
import { OneInchService } from "../one-inch/one-inch.service";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface McpRequest {
  jsonrpc: string;
  id: string | number;
  method: string;
  params?: any;
}

export interface McpResponse {
  jsonrpc: string;
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly aaveService: AaveService,
    private readonly swapService: SwapService,
    private readonly advancedSwapService: AdvancedSwapService,
    private readonly blockchainService: BlockchainService,
    private readonly smartDepositService: SmartDepositService,
    private readonly transactionBuilder: TransactionBuilderService,
    private readonly oneInchService: OneInchService,
  ) {}

  /**
   * Get all available MCP tools
   */
  getTools(): McpTool[] {
    return [
      // Aave Tools
      {
        name: "aave_stake",
        description:
          "Stake (supply) tokens to Aave V3 protocol on Base network",
        inputSchema: {
          type: "object",
          properties: {
            asset: {
              type: "string",
              description: "Token symbol (USDC, WETH, etc)",
              enum: ["USDC", "USDbC", "USDT", "DAI", "GHO", "EURC", "WETH", "cbETH", "wstETH", "weETH", "ezETH", "wrsETH", "cbBTC", "LBTC", "AAVE"],
            },
            amount: {
              type: "string",
              description: "Amount to stake",
            },
            userAddress: {
              type: "string",
              description: "User wallet address",
            },
          },
          required: ["asset", "amount", "userAddress"],
        },
      },
      {
        name: "aave_withdraw",
        description: "Withdraw staked tokens from Aave V3",
        inputSchema: {
          type: "object",
          properties: {
            asset: {
              type: "string",
              description: "Token symbol",
              enum: ["USDC", "USDbC", "USDT", "DAI", "GHO", "EURC", "WETH", "cbETH", "wstETH", "weETH", "ezETH", "wrsETH", "cbBTC", "LBTC", "AAVE"],
            },
            amount: {
              type: "string",
              description: 'Amount to withdraw (or "max" for all)',
            },
            userAddress: {
              type: "string",
              description: "User wallet address",
            },
          },
          required: ["asset", "amount", "userAddress"],
        },
      },
      {
        name: "aave_borrow",
        description: "Borrow tokens from Aave V3 using collateral",
        inputSchema: {
          type: "object",
          properties: {
            asset: {
              type: "string",
              description: "Token to borrow",
              enum: ["USDC", "USDbC", "USDT", "DAI", "GHO", "EURC"],
            },
            amount: {
              type: "string",
              description: "Amount to borrow",
            },
            rateMode: {
              type: "number",
              description: "Interest rate mode (1=stable, 2=variable)",
              default: 2,
            },
            userAddress: {
              type: "string",
              description: "User wallet address",
            },
          },
          required: ["asset", "amount", "rateMode", "userAddress"],
        },
      },
      {
        name: "aave_repay",
        description: "Repay borrowed tokens to Aave V3",
        inputSchema: {
          type: "object",
          properties: {
            asset: {
              type: "string",
              description: "Token to repay",
            },
            amount: {
              type: "string",
              description: 'Amount to repay (or "max" for all debt)',
            },
            rateMode: {
              type: "number",
              description: "Interest rate mode (1=stable, 2=variable)",
              default: 2,
            },
            userAddress: {
              type: "string",
              description: "User wallet address",
            },
          },
          required: ["asset", "amount", "rateMode", "userAddress"],
        },
      },
      {
        name: "aave_get_reserves",
        description:
          "Get all available reserves on Aave V3 with current APY rates",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "aave_get_strategies",
        description: "Get best yield strategies on Aave V3",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "aave_get_user_positions",
        description: "Get user positions on Aave V3",
        inputSchema: {
          type: "object",
          properties: {
            userAddress: {
              type: "string",
              description: "User wallet address",
            },
          },
          required: ["userAddress"],
        },
      },
      {
        name: "aave_get_user_account",
        description: "Get user account summary including health factor",
        inputSchema: {
          type: "object",
          properties: {
            userAddress: {
              type: "string",
              description: "User wallet address",
            },
          },
          required: ["userAddress"],
        },
      },

      // Swap Tools
      {
        name: "swap_quote",
        description: "Get swap quote from Uniswap V3 on Base network",
        inputSchema: {
          type: "object",
          properties: {
            fromToken: {
              type: "string",
              description: "Source token symbol",
            },
            toToken: {
              type: "string",
              description: "Destination token symbol",
            },
            amount: {
              type: "string",
              description: "Amount to swap",
            },
          },
          required: ["fromToken", "toToken", "amount"],
        },
      },
      {
        name: "swap_execute",
        description: "Execute token swap on Uniswap V3",
        inputSchema: {
          type: "object",
          properties: {
            fromToken: {
              type: "string",
              description: "Source token symbol",
            },
            toToken: {
              type: "string",
              description: "Destination token symbol",
            },
            amount: {
              type: "string",
              description: "Amount to swap",
            },
            slippage: {
              type: "number",
              description: "Max slippage percentage (default 1%)",
              default: 1,
            },
            userAddress: {
              type: "string",
              description: "User wallet address",
            },
          },
          required: ["fromToken", "toToken", "amount", "userAddress"],
        },
      },
      {
        name: "smart_stake",
        description:
          "Smart stake with automatic token swap if needed. Will swap tokens first if user does not have the target asset",
        inputSchema: {
          type: "object",
          properties: {
            targetAsset: {
              type: "string",
              description: "Token to stake (will swap if needed)",
              enum: ["USDC", "USDbC", "USDT", "DAI", "GHO", "EURC", "WETH", "cbETH", "wstETH", "weETH", "ezETH", "wrsETH", "cbBTC", "LBTC", "AAVE"],
            },
            targetAmount: {
              type: "string",
              description: "Amount to stake in target asset",
            },
            allowSwap: {
              type: "boolean",
              description: "Allow automatic token swap",
              default: true,
            },
            maxSlippage: {
              type: "number",
              description: "Max slippage for swap (1-5%)",
              default: 1,
            },
            userAddress: {
              type: "string",
              description: "User wallet address",
            },
          },
          required: ["targetAsset", "targetAmount", "userAddress"],
        },
      },
      {
        name: "smart_deposit_auto",
        description:
          "Automatic deposit from any token or ETH. Will find the best swap route and deposit to Aave",
        inputSchema: {
          type: "object",
          properties: {
            targetAmount: {
              type: "string",
              description: "Amount to deposit in USD",
            },
            targetAsset: {
              type: "string",
              description: "Asset to deposit (default: USDC)",
              enum: ["USDC", "USDbC", "USDT", "DAI", "GHO", "EURC", "WETH", "cbETH", "wstETH", "weETH", "ezETH", "wrsETH", "cbBTC", "LBTC", "AAVE"],
              default: "USDC",
            },
            userAddress: {
              type: "string",
              description: "Wallet address",
            },
            maxSlippage: {
              type: "number",
              description: "Maximum slippage for swap (1-5%)",
              default: 1,
            },
          },
          required: ["targetAmount"],
        },
      },

      // Transaction Builder Tools (No Private Key Required)
      {
        name: "prepare_aave_supply",
        description: "Prepare transaction for Aave deposit (for user signature)",
        inputSchema: {
          type: "object",
          properties: {
            asset: {
              type: "string",
              description: "Token to deposit",
              enum: ["USDC", "USDbC", "USDT", "DAI", "GHO", "EURC", "WETH", "cbETH", "wstETH", "weETH", "ezETH", "wrsETH", "cbBTC", "LBTC", "AAVE"],
            },
            amount: {
              type: "string",
              description: "Amount",
            },
            userAddress: {
              type: "string",
              description: "User address",
            },
          },
          required: ["asset", "amount", "userAddress"],
        },
      },
      {
        name: "prepare_swap",
        description: "Prepare swap transaction (for user signature)",
        inputSchema: {
          type: "object",
          properties: {
            tokenIn: {
              type: "string",
              description: "Input token",
            },
            tokenOut: {
              type: "string",
              description: "Output token",
            },
            amountIn: {
              type: "string",
              description: "Input amount (or amountOut)",
            },
            amountOut: {
              type: "string",
              description: "Output amount (or amountIn)",
            },
            userAddress: {
              type: "string",
              description: "User address",
            },
            slippagePercent: {
              type: "number",
              description: "Maximum slippage %",
              default: 1,
            },
          },
          required: ["tokenIn", "tokenOut", "userAddress"],
        },
      },
      {
        name: "prepare_typed_data",
        description: "Prepare EIP-712 typed data for signature",
        inputSchema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "Operation type",
              enum: ["AAVE_SUPPLY", "SWAP", "PERMIT"],
            },
            data: {
              type: "object",
              description: "Data to sign",
            },
            userAddress: {
              type: "string",
              description: "User address",
            },
          },
          required: ["type", "data", "userAddress"],
        },
      },
      {
        name: "simulate_transaction",
        description: "Simulate transaction execution",
        inputSchema: {
          type: "object",
          properties: {
            transaction: {
              type: "object",
              description: "Unsigned transaction",
            },
            from: {
              type: "string",
              description: "Sender address",
            },
          },
          required: ["transaction", "from"],
        },
      },
      {
        name: "broadcast_transaction",
        description: "Send signed transaction to blockchain",
        inputSchema: {
          type: "object",
          properties: {
            signedTx: {
              type: "string",
              description: "Signed transaction (hex)",
            },
          },
          required: ["signedTx"],
        },
      },

      // Blockchain Tools
      {
        name: "get_balance",
        description: "Get token balance for an address",
        inputSchema: {
          type: "object",
          properties: {
            address: {
              type: "string",
              description: "Wallet address",
            },
            token: {
              type: "string",
              description: "Token symbol (optional, ETH if not specified)",
            },
          },
          required: ["address"],
        },
      },
      {
        name: "get_all_balances",
        description: "Get all token balances for an address (ETH + all configured tokens)",
        inputSchema: {
          type: "object",
          properties: {
            address: {
              type: "string",
              description: "Wallet address",
            },
          },
          required: ["address"],
        },
      },
      {
        name: "get_gas_price",
        description: "Get current gas price on Base network",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },

      // Advanced swap with auto-funding
      {
        name: "smart_stake_auto_fund",
        description: "Smart stake with automatic ETH funding if not enough source token. Will use ETH to cover shortfalls, then swap to target token and stake",
        inputSchema: {
          type: "object",
          properties: {
            sourceToken: {
              type: "string",
              description: "Token to swap from (e.g., USDC)",
            },
            targetToken: {
              type: "string",
              description: "Token to stake (e.g., GHO)",
            },
            sourceAmount: {
              type: "string",
              description: "Amount of source token to use",
            },
            userAddress: {
              type: "string",
              description: "User wallet address",
            },
            useEthForShortfall: {
              type: "boolean",
              description: "Use ETH to cover any shortfall",
              default: true,
            },
          },
          required: ["sourceToken", "targetToken", "sourceAmount", "userAddress"],
        },
      },

      // 1inch Integration
      {
        name: "oneinch_quote",
        description: "Get swap quote from 1inch DEX aggregator (best rates across multiple DEXs)",
        inputSchema: {
          type: "object",
          properties: {
            fromToken: {
              type: "string",
              description: "Source token symbol",
            },
            toToken: {
              type: "string",
              description: "Destination token symbol",
            },
            amount: {
              type: "string",
              description: "Amount to swap",
            },
          },
          required: ["fromToken", "toToken", "amount"],
        },
      },
      {
        name: "oneinch_swap",
        description: "Execute swap via 1inch DEX aggregator with best route optimization",
        inputSchema: {
          type: "object",
          properties: {
            fromToken: {
              type: "string",
              description: "Source token symbol",
            },
            toToken: {
              type: "string",
              description: "Destination token symbol",
            },
            amount: {
              type: "string",
              description: "Amount to swap",
            },
            userAddress: {
              type: "string",
              description: "User wallet address",
            },
            slippage: {
              type: "number",
              description: "Max slippage percentage",
              default: 1,
            },
          },
          required: ["fromToken", "toToken", "amount", "userAddress"],
        },
      },
    ];
  }

  /**
   * Handle MCP request
   */
  async handleRequest(request: McpRequest): Promise<McpResponse> {
    this.logger.log(`MCP Request: ${request.method}`);

    try {
      switch (request.method) {
        case "initialize":
          return this.handleInitialize(request);

        case "tools/list":
          return this.handleListTools(request);

        case "tools/call":
          return await this.handleToolCall(request);

        case "completion/complete":
          return this.handleCompletion(request);

        default:
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`,
            },
          };
      }
    } catch (error) {
      this.logger.error(`MCP Error: ${error.message}`);
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32603,
          message: "Internal error",
          data: error.message,
        },
      };
    }
  }

  private handleInitialize(request: McpRequest): McpResponse {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
          completion: {
            models: ["aave-mcp"],
          },
        },
        serverInfo: {
          name: "aave-mcp",
          version: "1.0.0",
        },
      },
    };
  }

  private handleListTools(request: McpRequest): McpResponse {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: this.getTools(),
      },
    };
  }

  private async handleToolCall(request: McpRequest): Promise<McpResponse> {
    const { name, arguments: args } = request.params;
    this.logger.log(`Calling tool: ${name}`);

    try {
      let result: any;

      switch (name) {
        // Aave tools
        case "aave_stake":
          // First try regular stake
          try {
            result = await this.aaveService.stake(args);
          } catch (error) {
            // If insufficient balance, try smart stake with auto-funding
            if (error.message && error.message.includes('Insufficient')) {
              this.logger.log(`Insufficient balance for direct stake, trying smart stake with auto-funding...`);

              // Extract the needed info from error message
              const match = error.message.match(/Have: ([\d.]+), Need: ([\d.]+)/);
              if (match) {
                const have = parseFloat(match[1]);
                const need = parseFloat(match[2]);
                const shortfall = need - have;

                this.logger.log(`Need ${shortfall} more ${args.asset}, will try to swap from ETH or other tokens`);
              }

              // Use smart stake with auto-funding
              result = await this.swapService.smartStake({
                asset: args.asset,
                amount: args.amount,
                userAddress: args.userAddress,
                allowSwap: true,
                maxSlippage: 2, // Allow 2% slippage for emergency swaps
              });

              if (result.success || result.swap || result.stake) {
                // Format result to match expected output
                result = {
                  ...result,
                  message: `Smart stake completed: swapped from available tokens to get ${args.amount} ${args.asset} and staked on Aave`,
                };
              }
            } else {
              // Re-throw other errors
              throw error;
            }
          }
          break;

        case "aave_withdraw":
          result = await this.aaveService.withdraw(args);
          break;

        case "aave_borrow":
          result = await this.aaveService.borrow(args);
          break;

        case "aave_repay":
          result = await this.aaveService.repay(args);
          break;

        case "aave_get_reserves":
          result = await this.aaveService.getReserves();
          break;

        case "aave_get_strategies":
          result = await this.aaveService.getBestStrategies();
          break;

        case "aave_get_user_positions":
          result = await this.aaveService.getUserPositions(args.userAddress);
          break;

        case "aave_get_user_account":
          result = await this.aaveService.getUserAccountData(args.userAddress);
          break;

        // Swap tools
        case "swap_quote":
          result = await this.swapService.getQuote(args);
          break;

        case "swap_execute":
          // Check if user has enough balance, if not use smart swap
          try {
            const balances = await this.blockchainService.getAllBalances(args.userAddress);
            const sourceBalance = parseFloat(balances[args.fromToken] || balances[args.fromToken.toUpperCase()] || "0");
            const requiredAmount = parseFloat(args.amount);

            if (sourceBalance < requiredAmount) {
              this.logger.log(`Insufficient ${args.fromToken} balance (${sourceBalance} < ${requiredAmount}), trying smart swap`);

              // Try to use other tokens or ETH to get the required amount
              result = await this.advancedSwapService.smartStakeWithAutoFunding({
                sourceToken: args.fromToken,
                targetToken: args.toToken,
                sourceAmount: args.amount,
                userAddress: args.userAddress,
                useEthForShortfall: true
              });
            } else {
              result = await this.swapService.swap(args);
            }
          } catch (error) {
            // If smart swap fails, try regular swap
            this.logger.warn(`Smart swap failed: ${error.message}, trying regular swap`);
            result = await this.swapService.swap(args);
          }
          break;

        case "smart_stake":
          result = await this.swapService.smartStake(args);
          break;

        case "smart_deposit_auto":
          result = await this.smartDepositService.smartDeposit(args);
          break;

        // Transaction builder tools
        case "prepare_aave_supply":
          result = await this.transactionBuilder.prepareAaveSupply(args);
          break;

        case "prepare_swap":
          result = await this.transactionBuilder.prepareSwap(args);
          break;

        case "prepare_typed_data":
          result = await this.transactionBuilder.prepareTypedData(args);
          break;

        case "simulate_transaction":
          result = await this.transactionBuilder.simulateTransaction(
            args.transaction,
            args.from,
          );
          break;

        case "broadcast_transaction":
          result = await this.transactionBuilder.broadcastTransaction(args.signedTx);
          break;

        // Blockchain tools
        case "get_balance":
          // Handle ETH as native token (not ERC20)
          if (args.token && args.token.toUpperCase() === 'ETH') {
            // Get ETH balance directly
            result = await this.blockchainService.getBalance(
              args.address,
              undefined, // undefined means get ETH balance
            );
          } else if (args.token) {
            // Get ERC20 token balance
            const tokenAddress = this.blockchainService.getTokenAddress(args.token);
            result = await this.blockchainService.getBalance(
              args.address,
              tokenAddress,
            );
          } else {
            // Default to ETH if no token specified
            result = await this.blockchainService.getBalance(
              args.address,
              undefined,
            );
          }
          break;

        case "get_all_balances":
          result = await this.blockchainService.getAllBalances(args.address);
          break;

        case "get_gas_price":
          result = await this.blockchainService.getGasPrice();
          break;

        case "smart_stake_auto_fund":
          result = await this.advancedSwapService.smartStakeWithAutoFunding({
            sourceToken: args.sourceToken,
            targetToken: args.targetToken,
            sourceAmount: args.sourceAmount,
            userAddress: args.userAddress,
            useEthForShortfall: args.useEthForShortfall ?? true,
          });
          break;

        // 1inch tools
        case "oneinch_quote":
          result = await this.oneInchService.getQuote({
            fromToken: args.fromToken,
            toToken: args.toToken,
            amount: args.amount,
            userAddress: args.userAddress,
          });
          break;

        case "oneinch_swap":
          result = await this.oneInchService.executeSwap({
            fromToken: args.fromToken,
            toToken: args.toToken,
            amount: args.amount,
            userAddress: args.userAddress,
            slippage: args.slippage || 1,
          });
          break;

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        },
      };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32000,
          message: `Tool execution failed: ${error.message}`,
        },
      };
    }
  }

  private handleCompletion(request: McpRequest): McpResponse {
    const { prompt } = request.params.messages[0];

    // Simple completion helper
    const completions = {
      "stake ": ["USDC", "WETH", "DAI", "cbETH"],
      "withdraw ": ["USDC", "WETH", "DAI", "cbETH", "max"],
      "swap ": ["USDC to WETH", "WETH to USDC", "USDT to USDC"],
      "smart_stake ": ["10 USDC", "0.1 WETH", "100 DAI"],
    };

    for (const [prefix, suggestions] of Object.entries(completions)) {
      if (prompt.toLowerCase().includes(prefix)) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            completion: {
              values: suggestions.map((s) => prompt + s),
            },
          },
        };
      }
    }

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        completion: {
          values: [],
        },
      },
    };
  }
}
