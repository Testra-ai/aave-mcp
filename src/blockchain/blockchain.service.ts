import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ethers } from "ethers";

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private provider: ethers.providers.JsonRpcProvider;
  private wallet: ethers.Wallet | null = null;
  private decimalsCache: Map<string, number> = new Map();

  constructor(private configService: ConfigService) {
    const rpcUrl = this.configService.get<string>("blockchain.rpcUrl");
    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);

    const privateKey = this.configService.get<string>("blockchain.privateKey");
    if (privateKey) {
      this.wallet = new ethers.Wallet(privateKey, this.provider);
      this.logger.log(`Wallet initialized: ${this.wallet.address}`);
    }

    // Preload decimals for known tokens
    setTimeout(() => this.preloadTokenDecimals(), 100);
  }

  private async preloadTokenDecimals(): Promise<void> {
    const tokens = this.configService.get<Record<string, string>>("tokens") || {};

    // Known decimals for common tokens to avoid RPC calls
    const knownDecimals: Record<string, number> = {
      USDC: 6,
      USDbC: 6,
      USDT: 6,
      EURC: 6,
      DAI: 18,
      GHO: 18,
      WETH: 18,
      cbETH: 18,
      wstETH: 18,
      weETH: 18,
      ezETH: 18,
      wrsETH: 18,
      cbBTC: 8,
      LBTC: 8,
      AAVE: 18
    };

    // Preload known decimals into cache
    for (const [symbol, address] of Object.entries(tokens)) {
      if (knownDecimals[symbol] !== undefined) {
        this.decimalsCache.set(address, knownDecimals[symbol]);
        this.logger.debug(`Preloaded decimals for ${symbol}: ${knownDecimals[symbol]}`);
      }
    }

    this.logger.log(`Preloaded decimals for ${this.decimalsCache.size} tokens`);
  }

  getProvider(): ethers.providers.JsonRpcProvider {
    return this.provider;
  }

  getWallet(): ethers.Wallet | null {
    return this.wallet;
  }

  getSigner(userAddress?: string): ethers.Signer {
    if (userAddress && !this.wallet) {
      // Read-only mode for specific user
      return this.provider.getSigner(userAddress);
    }
    if (this.wallet) {
      return this.wallet;
    }
    throw new Error("No wallet configured and no user address provided");
  }

  async getBalance(address: string, tokenAddress?: string): Promise<string> {
    try {
      if (!tokenAddress) {
        // Native ETH balance
        const balance = await this.provider.getBalance(address);
        return ethers.utils.formatEther(balance);
      }

      // ERC20 token balance
      const tokenContract = new ethers.Contract(
        tokenAddress,
        [
          "function balanceOf(address) view returns (uint256)",
          "function decimals() view returns (uint8)"
        ],
        this.provider,
      );

      // Get both balance and decimals
      const [balance, decimals] = await Promise.all([
        tokenContract.balanceOf(address),
        tokenContract.decimals().catch(() => 6) // Default to 6 if decimals() fails
      ]);

      return ethers.utils.formatUnits(balance, decimals);
    } catch (error) {
      this.logger.error(`Error getting balance: ${error.message}`);
      throw error;
    }
  }

  async getTokenDecimals(tokenAddress: string): Promise<number> {
    // Check cache first
    if (this.decimalsCache.has(tokenAddress)) {
      return this.decimalsCache.get(tokenAddress)!;
    }

    try {
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ["function decimals() view returns (uint8)"],
        this.provider,
      );
      const decimals = await tokenContract.decimals();

      // Cache the result
      this.decimalsCache.set(tokenAddress, decimals);
      this.logger.debug(`Cached decimals for ${tokenAddress}: ${decimals}`);

      return decimals;
    } catch (error) {
      this.logger.warn(
        `Error getting decimals for ${tokenAddress}, checking common patterns`,
      );

      // Try to determine decimals based on known token patterns
      const tokenSymbol = await this.getTokenSymbol(tokenAddress).catch(() => "");

      // Common decimal patterns
      if (tokenSymbol.includes("USDC") || tokenSymbol.includes("USDT") || tokenSymbol.includes("EURC")) {
        this.decimalsCache.set(tokenAddress, 6);
        return 6;
      }
      if (tokenSymbol.includes("DAI") || tokenSymbol.includes("GHO") ||
          tokenSymbol.includes("ETH") || tokenSymbol.includes("BTC") ||
          tokenSymbol.includes("AAVE")) {
        this.decimalsCache.set(tokenAddress, 18);
        return 18;
      }

      // Default to 18 (most common for ERC20)
      this.decimalsCache.set(tokenAddress, 18);
      return 18;
    }
  }

  async getTokenSymbol(tokenAddress: string): Promise<string> {
    try {
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ["function symbol() view returns (string)"],
        this.provider,
      );
      return await tokenContract.symbol();
    } catch (error) {
      this.logger.error(`Error getting symbol for ${tokenAddress}`);
      throw error;
    }
  }

  async getCurrentBlock(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  async getGasPrice(): Promise<string> {
    const gasPrice = await this.provider.getGasPrice();
    return ethers.utils.formatUnits(gasPrice, "gwei");
  }

  async estimateGas(
    transaction: ethers.providers.TransactionRequest,
  ): Promise<string> {
    const estimate = await this.provider.estimateGas(transaction);
    return estimate.toString();
  }

  async waitForTransaction(
    txHash: string,
    confirmations = 1,
  ): Promise<ethers.providers.TransactionReceipt> {
    this.logger.log(
      `Waiting for transaction ${txHash} with ${confirmations} confirmations...`,
    );
    const receipt = await this.provider.waitForTransaction(
      txHash,
      confirmations,
    );
    this.logger.log(
      `Transaction ${txHash} confirmed in block ${receipt.blockNumber}`,
    );
    return receipt;
  }

  getTokenAddress(symbol: string): string {
    const tokens = this.configService.get<Record<string, string>>("tokens")!;

    // Try exact match first (for mixed case like cbETH, wstETH)
    let address = tokens[symbol];

    // If not found, try uppercase (for USDC, WETH, etc)
    if (!address) {
      address = tokens[symbol.toUpperCase()];
    }

    if (!address) {
      throw new Error(`Token ${symbol} not supported`);
    }
    return address;
  }

  isAutoExecuteEnabled(): boolean {
    // return this.configService.get<boolean>("blockchain.autoExecute") || false;
    return true;
  }

  getWalletAddress(): string {
    if (this.wallet) {
      return this.wallet.address;
    }
    // Return test wallet if no wallet configured
    return this.configService.get<string>("TEST_WALLET_ADDRESS") || "";
  }

  async getTokenBalance(address: string, tokenSymbol: string): Promise<ethers.BigNumber> {
    try {
      const tokenAddress = this.getTokenAddress(tokenSymbol);
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ["function balanceOf(address) view returns (uint256)"],
        this.provider,
      );
      return await tokenContract.balanceOf(address);
    } catch (error) {
      this.logger.error(`Error getting ${tokenSymbol} balance: ${error.message}`);
      return ethers.BigNumber.from(0);
    }
  }

  getTransactionUrl(txHash: string): string {
    const chainId = this.configService.get<number>("blockchain.chainId");

    // BaseScan URL for Base mainnet
    if (chainId === 8453) {
      return `https://basescan.org/tx/${txHash}`;
    }

    // Fallback for other networks
    return txHash;
  }

  async getAllBalances(address: string): Promise<Record<string, string>> {
    const balances: Record<string, string> = {};

    try {
      // Get ETH balance
      const ethBalance = await this.provider.getBalance(address);
      balances.ETH = ethers.utils.formatEther(ethBalance);

      // Get all configured token balances
      const tokens = this.configService.get<Record<string, string>>("tokens") || {};

      // Fetch all balances in parallel
      const tokenBalancePromises = Object.entries(tokens).map(async ([symbol, tokenAddress]) => {
        try {
          const balance = await this.getBalance(address, tokenAddress);
          return { symbol, balance };
        } catch (error) {
          this.logger.warn(`Failed to get balance for ${symbol}: ${error.message}`);
          return { symbol, balance: "0" };
        }
      });

      const tokenBalances = await Promise.all(tokenBalancePromises);

      // Add token balances to result
      tokenBalances.forEach(({ symbol, balance }) => {
        balances[symbol] = balance;
      });

    } catch (error) {
      this.logger.error(`Error getting all balances: ${error.message}`);
      throw error;
    }

    return balances;
  }

  /**
   * Wrap ETH to WETH
   */
  async wrapETH(amount: string, userAddress: string): Promise<any> {
    try {
      const wethAddress = this.getTokenAddress('WETH');
      const wethContract = new ethers.Contract(
        wethAddress,
        [
          'function deposit() payable',
          'function withdraw(uint256 amount)',
          'function balanceOf(address) view returns (uint256)'
        ],
        this.getProvider()
      );

      const amountWei = ethers.utils.parseEther(amount);

      if (!this.isAutoExecuteEnabled()) {
        return {
          success: true,
          simulation: true,
          message: `Would wrap ${amount} ETH to WETH`,
          amount,
        };
      }

      const signer = this.getSigner(userAddress);
      const tx = await wethContract.connect(signer).deposit({ value: amountWei });
      const receipt = await tx.wait();

      this.logger.log(`Wrapped ${amount} ETH to WETH: ${tx.hash}`);

      return {
        success: true,
        transactionHash: tx.hash,
        transactionUrl: this.getTransactionUrl(tx.hash),
        amount,
        protocol: 'WETH'
      };
    } catch (error) {
      this.logger.error(`Failed to wrap ETH: ${error.message}`);
      throw error;
    }
  }

  /**
   * Unwrap WETH to ETH
   */
  async unwrapWETH(amount: string, userAddress: string): Promise<any> {
    try {
      const wethAddress = this.getTokenAddress('WETH');
      const wethContract = new ethers.Contract(
        wethAddress,
        ['function withdraw(uint256 amount)'],
        this.getProvider()
      );

      const amountWei = ethers.utils.parseEther(amount);

      if (!this.isAutoExecuteEnabled()) {
        return {
          success: true,
          simulation: true,
          message: `Would unwrap ${amount} WETH to ETH`,
          amount,
        };
      }

      const signer = this.getSigner(userAddress);
      const tx = await wethContract.connect(signer).withdraw(amountWei);
      const receipt = await tx.wait();

      this.logger.log(`Unwrapped ${amount} WETH to ETH: ${tx.hash}`);

      return {
        success: true,
        transactionHash: tx.hash,
        transactionUrl: this.getTransactionUrl(tx.hash),
        amount,
        protocol: 'WETH'
      };
    } catch (error) {
      this.logger.error(`Failed to unwrap WETH: ${error.message}`);
      throw error;
    }
  }
}
