import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { ConfigService } from '@nestjs/config';
import { BlockchainService } from '../blockchain/blockchain.service';

export interface UnsignedTransaction {
  to: string;
  data: string;
  value: string;
  nonce: number;
  gasLimit: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  chainId: number;
  type?: number;
}

export interface PreparedTransaction {
  transaction: UnsignedTransaction;
  estimatedGas: string;
  estimatedCost: string;
  deadline: number;
  description: string;
  simulation?: any;
}

export interface EIP712TypedData {
  types: Record<string, Array<{ name: string; type: string }>>;
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  message: Record<string, any>;
  primaryType: string;
}

@Injectable()
export class TransactionBuilderService {
  private readonly logger = new Logger(TransactionBuilderService.name);
  
  constructor(
    private readonly configService: ConfigService,
    private readonly blockchainService: BlockchainService,
  ) {}

  /**
   * Prepare Aave supply transaction for signing
   */
  async prepareAaveSupply(params: {
    asset: string;
    amount: string;
    userAddress: string;
  }): Promise<PreparedTransaction> {
    const provider = this.blockchainService.getProvider();
    const poolAddress = this.configService.get('contracts.aavePool');
    const tokenAddress = this.blockchainService.getTokenAddress(params.asset);
    
    // Encode function data
    const poolInterface = new ethers.utils.Interface([
      'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
    ]);
    
    const decimals = await this.getTokenDecimals(tokenAddress);
    const amountWei = ethers.utils.parseUnits(params.amount, decimals);
    
    const data = poolInterface.encodeFunctionData('supply', [
      tokenAddress,
      amountWei,
      params.userAddress,
      0, // referral code
    ]);
    
    // Get nonce and gas
    const nonce = await provider.getTransactionCount(params.userAddress, 'pending');
    const gasPrice = await provider.getGasPrice();
    
    // Build transaction
    const transaction: UnsignedTransaction = {
      to: poolAddress,
      data,
      value: '0',
      nonce,
      gasLimit: '250000', // Will be estimated
      gasPrice: gasPrice.toString(),
      chainId: this.configService.get('blockchain.chainId') || 8453,
      type: 2, // EIP-1559
    };
    
    // Estimate gas
    try {
      const estimatedGas = await provider.estimateGas({
        from: params.userAddress,
        to: transaction.to,
        data: transaction.data,
        value: transaction.value,
      });
      transaction.gasLimit = estimatedGas.mul(120).div(100).toString(); // Add 20% buffer
    } catch (error) {
      this.logger.warn('Gas estimation failed, using default');
    }
    
    const estimatedCost = ethers.BigNumber.from(transaction.gasLimit)
      .mul(gasPrice)
      .toString();
    
    return {
      transaction,
      estimatedGas: transaction.gasLimit,
      estimatedCost,
      deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      description: `Supply ${params.amount} ${params.asset} to Aave V3`,
    };
  }

  /**
   * Prepare Uniswap swap transaction
   */
  async prepareSwap(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn?: string;
    amountOut?: string;
    userAddress: string;
    slippagePercent?: number;
  }): Promise<PreparedTransaction> {
    const provider = this.blockchainService.getProvider();
    const routerAddress = this.configService.get('contracts.uniswapRouter');
    const slippage = params.slippagePercent || 1;
    
    const tokenInAddress = params.tokenIn === 'ETH' 
      ? this.blockchainService.getTokenAddress('WETH')
      : this.blockchainService.getTokenAddress(params.tokenIn);
    const tokenOutAddress = this.blockchainService.getTokenAddress(params.tokenOut);
    
    let data: string;
    let value = '0';
    let description: string;
    
    if (params.amountIn) {
      // Exact input swap
      const decimalsIn = await this.getTokenDecimals(tokenInAddress);
      const amountIn = ethers.utils.parseUnits(params.amountIn, decimalsIn);
      
      if (params.tokenIn === 'ETH') {
        value = amountIn.toString();
      }
      
      const routerInterface = new ethers.utils.Interface([
        'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
      ]);
      
      data = routerInterface.encodeFunctionData('exactInputSingle', [{
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        fee: 3000, // 0.3% - most common
        recipient: params.userAddress,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        amountIn: amountIn,
        amountOutMinimum: 0, // Will calculate with slippage
        sqrtPriceLimitX96: 0,
      }]);
      
      description = `Swap ${params.amountIn} ${params.tokenIn} for ${params.tokenOut}`;
    } else if (params.amountOut) {
      // Exact output swap
      const decimalsOut = await this.getTokenDecimals(tokenOutAddress);
      const amountOut = ethers.utils.parseUnits(params.amountOut, decimalsOut);
      
      const routerInterface = new ethers.utils.Interface([
        'function exactOutputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)',
      ]);
      
      // Need to calculate max amount in with slippage
      const maxAmountIn = await this.getQuoteForSwap(tokenInAddress, tokenOutAddress, amountOut);
      const maxWithSlippage = maxAmountIn.mul(100 + slippage).div(100);
      
      if (params.tokenIn === 'ETH') {
        value = maxWithSlippage.toString();
      }
      
      data = routerInterface.encodeFunctionData('exactOutputSingle', [{
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        fee: 3000,
        recipient: params.userAddress,
        amountOut: amountOut,
        amountInMaximum: maxWithSlippage,
        sqrtPriceLimitX96: 0,
      }]);
      
      description = `Swap ${params.tokenIn} for ${params.amountOut} ${params.tokenOut}`;
    } else {
      throw new Error('Either amountIn or amountOut must be specified');
    }
    
    const nonce = await provider.getTransactionCount(params.userAddress, 'pending');
    const gasPrice = await provider.getGasPrice();
    
    const transaction: UnsignedTransaction = {
      to: routerAddress,
      data,
      value,
      nonce,
      gasLimit: '300000',
      gasPrice: gasPrice.toString(),
      chainId: this.configService.get('blockchain.chainId') || 8453,
    };
    
    // Estimate gas
    try {
      const estimatedGas = await provider.estimateGas({
        from: params.userAddress,
        to: transaction.to,
        data: transaction.data,
        value: transaction.value,
      });
      transaction.gasLimit = estimatedGas.mul(120).div(100).toString();
    } catch (error) {
      this.logger.warn('Gas estimation failed, using default');
    }
    
    const estimatedCost = ethers.BigNumber.from(transaction.gasLimit)
      .mul(gasPrice)
      .add(value)
      .toString();
    
    return {
      transaction,
      estimatedGas: transaction.gasLimit,
      estimatedCost,
      deadline: Math.floor(Date.now() / 1000) + 3600,
      description,
    };
  }

  /**
   * Prepare EIP-712 typed data for signing
   */
  prepareTypedData(params: {
    type: 'AAVE_SUPPLY' | 'SWAP' | 'PERMIT';
    data: any;
    userAddress: string;
  }): EIP712TypedData {
    const chainId = this.configService.get('blockchain.chainId') || 8453;
    
    if (params.type === 'AAVE_SUPPLY') {
      return {
        types: {
          AaveSupply: [
            { name: 'asset', type: 'address' },
            { name: 'amount', type: 'uint256' },
            { name: 'recipient', type: 'address' },
            { name: 'deadline', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
          ],
        },
        domain: {
          name: 'Aave MCP Server',
          version: '1',
          chainId,
          verifyingContract: this.configService.get('contracts.aavePool') || '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
        },
        message: {
          asset: params.data.asset,
          amount: params.data.amount,
          recipient: params.userAddress,
          deadline: Math.floor(Date.now() / 1000) + 3600,
          nonce: params.data.nonce || 0,
        },
        primaryType: 'AaveSupply',
      };
    }
    
    if (params.type === 'SWAP') {
      return {
        types: {
          Swap: [
            { name: 'tokenIn', type: 'address' },
            { name: 'tokenOut', type: 'address' },
            { name: 'amountIn', type: 'uint256' },
            { name: 'amountOutMin', type: 'uint256' },
            { name: 'recipient', type: 'address' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        domain: {
          name: 'Uniswap V3',
          version: '1',
          chainId,
          verifyingContract: this.configService.get('contracts.uniswapRouter') || '0x2626664c2603336E57B271c5C0b26F421741e481',
        },
        message: params.data,
        primaryType: 'Swap',
      };
    }
    
    throw new Error(`Unsupported type: ${params.type}`);
  }

  /**
   * Simulate transaction execution
   */
  async simulateTransaction(
    transaction: UnsignedTransaction,
    from: string,
  ): Promise<{ success: boolean; result?: any; error?: string }> {
    const provider = this.blockchainService.getProvider();
    
    try {
      const result = await provider.call({
        from,
        to: transaction.to,
        data: transaction.data,
        value: transaction.value,
        gasLimit: transaction.gasLimit,
      });
      
      return {
        success: true,
        result,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.reason || error.message,
      };
    }
  }

  /**
   * Verify signed transaction
   */
  async verifySignedTransaction(
    signedTx: string,
  ): Promise<{ valid: boolean; from?: string; error?: string }> {
    try {
      const tx = ethers.utils.parseTransaction(signedTx);
      const from = tx.from;
      
      return {
        valid: true,
        from,
      };
    } catch (error: any) {
      return {
        valid: false,
        error: error.message,
      };
    }
  }

  /**
   * Broadcast signed transaction
   */
  async broadcastTransaction(signedTx: string): Promise<{
    success: boolean;
    hash?: string;
    error?: string;
  }> {
    const provider = this.blockchainService.getProvider();
    
    try {
      const response = await provider.sendTransaction(signedTx);
      return {
        success: true,
        hash: response.hash,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.reason || error.message,
      };
    }
  }

  private async getTokenDecimals(tokenAddress: string): Promise<number> {
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ['function decimals() view returns (uint8)'],
      this.blockchainService.getProvider(),
    );
    return await tokenContract.decimals();
  }

  private async getQuoteForSwap(
    tokenIn: string,
    tokenOut: string,
    amountOut: ethers.BigNumber,
  ): Promise<ethers.BigNumber> {
    // Simplified - in production would use Quoter contract
    // For now return a reasonable estimate
    return amountOut.mul(110).div(100); // Assume 10% premium
  }

  /**
   * Prepare transaction for wagmi/viem integration
   * Returns data formatted for usePrepareContractWrite and useContractWrite hooks
   */
  async prepareForWagmi(dto: {
    action: 'deposit' | 'withdraw' | 'swap';
    asset: string;
    amount: string;
    userAddress: string;
    tokenOut?: string;
  }): Promise<{
    address: string;
    abi: any[];
    functionName: string;
    args: any[];
    value?: string;
    enabled: boolean;
    gas?: string;
    chainId: number;
    wagmiConfig: any;
  }> {
    const provider = this.blockchainService.getProvider();
    const chainId = await provider.getNetwork().then(n => n.chainId);

    if (dto.action === 'deposit') {
      // Prepare Aave deposit
      const aavePoolAddress = this.configService.get<string>('AAVE_POOL') || '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
      const tokenAddress = this.blockchainService.getTokenAddress(dto.asset);
      const amount = ethers.utils.parseUnits(dto.amount, dto.asset === 'USDC' || dto.asset === 'USDT' ? 6 : 18);

      // Return both approve and supply configurations
      return {
        address: aavePoolAddress,
        abi: [
          {
            inputs: [
              { internalType: 'address', name: 'asset', type: 'address' },
              { internalType: 'uint256', name: 'amount', type: 'uint256' },
              { internalType: 'address', name: 'onBehalfOf', type: 'address' },
              { internalType: 'uint16', name: 'referralCode', type: 'uint16' }
            ],
            name: 'supply',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function'
          }
        ],
        functionName: 'supply',
        args: [tokenAddress, amount, dto.userAddress, 0],
        value: undefined,
        enabled: true,
        gas: '300000',
        chainId: chainId,
        wagmiConfig: {
          // Token approval config (to be done first)
          approve: {
            address: tokenAddress,
            abi: [
              {
                inputs: [
                  { internalType: 'address', name: 'spender', type: 'address' },
                  { internalType: 'uint256', name: 'amount', type: 'uint256' }
                ],
                name: 'approve',
                outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
                stateMutability: 'nonpayable',
                type: 'function'
              }
            ],
            functionName: 'approve',
            args: [aavePoolAddress, amount],
          },
          // Example wagmi hook usage
          example: `
// In your React component with wagmi:
import { usePrepareContractWrite, useContractWrite, useWaitForTransaction } from 'wagmi'

// Step 1: Approve token
const { config: approveConfig } = usePrepareContractWrite({
  address: '${tokenAddress}',
  abi: [...], // approve ABI
  functionName: 'approve',
  args: ['${aavePoolAddress}', '${amount}'],
})

const { write: approve, data: approveTx } = useContractWrite(approveConfig)
const { isLoading: isApproving } = useWaitForTransaction({ hash: approveTx?.hash })

// Step 2: Deposit to Aave
const { config: depositConfig } = usePrepareContractWrite({
  address: '${aavePoolAddress}',
  abi: [...], // supply ABI
  functionName: 'supply',
  args: ['${tokenAddress}', '${amount}', userAddress, 0],
  enabled: !!approveTx, // Only enable after approval
})

const { write: deposit } = useContractWrite(depositConfig)
          `.trim()
        }
      };
    } else if (dto.action === 'swap') {
      // Prepare Uniswap swap
      const uniswapRouter = this.configService.get<string>('UNISWAP_ROUTER') || '0x2626664c2603336E57B271c5C0b26F421741e481';
      const tokenInAddress = this.blockchainService.getTokenAddress(dto.asset);
      const tokenOutAddress = this.blockchainService.getTokenAddress(dto.tokenOut || 'USDC');
      const amountIn = ethers.utils.parseUnits(dto.amount, dto.asset === 'ETH' ? 18 : 6);

      return {
        address: uniswapRouter,
        abi: [
          {
            inputs: [
              {
                components: [
                  { internalType: 'address', name: 'tokenIn', type: 'address' },
                  { internalType: 'address', name: 'tokenOut', type: 'address' },
                  { internalType: 'uint24', name: 'fee', type: 'uint24' },
                  { internalType: 'address', name: 'recipient', type: 'address' },
                  { internalType: 'uint256', name: 'deadline', type: 'uint256' },
                  { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
                  { internalType: 'uint256', name: 'amountOutMinimum', type: 'uint256' },
                  { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' }
                ],
                internalType: 'struct ISwapRouter.ExactInputSingleParams',
                name: 'params',
                type: 'tuple'
              }
            ],
            name: 'exactInputSingle',
            outputs: [{ internalType: 'uint256', name: 'amountOut', type: 'uint256' }],
            stateMutability: 'payable',
            type: 'function'
          }
        ],
        functionName: 'exactInputSingle',
        args: [{
          tokenIn: tokenInAddress,
          tokenOut: tokenOutAddress,
          fee: 3000, // 0.3%
          recipient: dto.userAddress,
          deadline: Math.floor(Date.now() / 1000) + 3600,
          amountIn: amountIn,
          amountOutMinimum: 0, // Should calculate with slippage
          sqrtPriceLimitX96: 0
        }],
        value: dto.asset === 'ETH' ? amountIn.toString() : undefined,
        enabled: true,
        gas: '350000',
        chainId: chainId,
        wagmiConfig: {
          note: 'For ETH swaps, include value. For token swaps, approve first.',
          example: `
// Swap with wagmi:
const { config } = usePrepareContractWrite({
  address: '${uniswapRouter}',
  abi: [...], // exactInputSingle ABI
  functionName: 'exactInputSingle',
  args: [swapParams],
  ${dto.asset === 'ETH' ? `value: BigInt('${amountIn}'),` : ''}
})

const { write: swap } = useContractWrite(config)
          `.trim()
        }
      };
    } else {
      // Withdraw from Aave
      const aavePoolAddress = this.configService.get<string>('AAVE_POOL') || '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
      const tokenAddress = this.blockchainService.getTokenAddress(dto.asset);
      const amount = ethers.utils.parseUnits(dto.amount, dto.asset === 'USDC' || dto.asset === 'USDT' ? 6 : 18);

      return {
        address: aavePoolAddress,
        abi: [
          {
            inputs: [
              { internalType: 'address', name: 'asset', type: 'address' },
              { internalType: 'uint256', name: 'amount', type: 'uint256' },
              { internalType: 'address', name: 'to', type: 'address' }
            ],
            name: 'withdraw',
            outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
            stateMutability: 'nonpayable',
            type: 'function'
          }
        ],
        functionName: 'withdraw',
        args: [tokenAddress, amount, dto.userAddress],
        value: undefined,
        enabled: true,
        gas: '300000',
        chainId: chainId,
        wagmiConfig: {
          example: `
// Withdraw with wagmi:
const { config } = usePrepareContractWrite({
  address: '${aavePoolAddress}',
  abi: [...], // withdraw ABI
  functionName: 'withdraw',
  args: ['${tokenAddress}', '${amount}', userAddress],
})

const { write: withdraw } = useContractWrite(config)
          `.trim()
        }
      };
    }
  }
}