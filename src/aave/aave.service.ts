import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ethers } from "ethers";
import { BlockchainService } from "../blockchain/blockchain.service";
import {
  StakeDto,
  WithdrawDto,
  BorrowDto,
  RepayDto,
} from "../common/dto/stake.dto";

// Aave V3 Pool ABI (minimal)
const POOL_ABI = [
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
  "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)",
  "function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)",
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
];

// Pool Data Provider ABI (minimal)
const DATA_PROVIDER_ABI = [
  "function getUserReserveData(address asset, address user) view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)",
  "function getReserveData(address asset) view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)",
  "function getReserveConfigurationData(address asset) view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)",
  "function getAllReservesTokens() view returns (tuple(string symbol, address tokenAddress)[])",
];

// ERC20 ABI (minimal)
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

export interface ReserveData {
  symbol: string;
  address: string;
  apy: number;
  borrowApy: number;
  totalSupplied: string;
  totalBorrowed: string;
  availableLiquidity: string;
  usageAsCollateralEnabled: boolean;
  ltv: number;
}

export interface UserPosition {
  asset: string;
  supplied: string;
  borrowed: string;
  apy: number;
  borrowApy?: number;
  collateralEnabled: boolean;
}

export interface UserAccountData {
  totalCollateral: string;
  totalDebt: string;
  availableBorrows: string;
  currentLiquidationThreshold: number;
  ltv: number;
  healthFactor: string;
}

@Injectable()
export class AaveService {
  private readonly logger = new Logger(AaveService.name);
  private poolContract: ethers.Contract;
  private dataProviderContract: ethers.Contract;

  constructor(
    private configService: ConfigService,
    private blockchainService: BlockchainService,
  ) {
    const provider = this.blockchainService.getProvider();
    const poolAddress = this.configService.get<string>("contracts.aavePool")!;
    const dataProviderAddress = this.configService.get<string>(
      "contracts.poolDataProvider",
    )!;

    this.poolContract = new ethers.Contract(poolAddress, POOL_ABI, provider);
    this.dataProviderContract = new ethers.Contract(
      dataProviderAddress,
      DATA_PROVIDER_ABI,
      provider,
    );
  }

  async getReserves(): Promise<ReserveData[]> {
    try {
      const reserves = await this.dataProviderContract.getAllReservesTokens();
      const reserveData: ReserveData[] = [];

      for (const reserve of reserves) {
        try {
          const [reserveInfo, configData] = await Promise.all([
            this.dataProviderContract.getReserveData(reserve.tokenAddress),
            this.dataProviderContract.getReserveConfigurationData(
              reserve.tokenAddress,
            ),
          ]);

          const liquidityRate = Number(reserveInfo.liquidityRate) / 1e25; // Ray to percentage
          const variableBorrowRate =
            Number(reserveInfo.variableBorrowRate) / 1e25;

          reserveData.push({
            symbol: reserve.symbol,
            address: reserve.tokenAddress,
            apy: liquidityRate,
            borrowApy: variableBorrowRate,
            totalSupplied: ethers.utils.formatUnits(
              reserveInfo.totalAToken,
              configData.decimals,
            ),
            totalBorrowed: ethers.utils.formatUnits(
              reserveInfo.totalVariableDebt.add(reserveInfo.totalStableDebt),
              configData.decimals,
            ),
            availableLiquidity: ethers.utils.formatUnits(
              reserveInfo.totalAToken
                .sub(reserveInfo.totalVariableDebt)
                .sub(reserveInfo.totalStableDebt),
              configData.decimals,
            ),
            usageAsCollateralEnabled: configData.usageAsCollateralEnabled,
            ltv: Number(configData.ltv) / 100,
          });
        } catch (error) {
          this.logger.warn(
            `Failed to get data for reserve ${reserve.symbol}: ${error.message}`,
          );
        }
      }

      return reserveData;
    } catch (error) {
      this.logger.error(`Error getting reserves: ${error.message}`);
      throw error;
    }
  }

  async getUserPositions(userAddress: string): Promise<UserPosition[]> {
    try {
      const reserves = await this.dataProviderContract.getAllReservesTokens();
      const positions: UserPosition[] = [];

      for (const reserve of reserves) {
        const userData = await this.dataProviderContract.getUserReserveData(
          reserve.tokenAddress,
          userAddress,
        );

        if (
          userData.currentATokenBalance.gt(0) ||
          userData.currentVariableDebt.gt(0) ||
          userData.currentStableDebt.gt(0)
        ) {
          const decimals = await this.blockchainService.getTokenDecimals(
            reserve.tokenAddress,
          );
          const reserveInfo = await this.dataProviderContract.getReserveData(
            reserve.tokenAddress,
          );

          positions.push({
            asset: reserve.symbol,
            supplied: ethers.utils.formatUnits(
              userData.currentATokenBalance,
              decimals,
            ),
            borrowed: ethers.utils.formatUnits(
              userData.currentVariableDebt.add(userData.currentStableDebt),
              decimals,
            ),
            apy: Number(reserveInfo.liquidityRate) / 1e25,
            borrowApy: Number(reserveInfo.variableBorrowRate) / 1e25,
            collateralEnabled: userData.usageAsCollateralEnabled,
          });
        }
      }

      return positions;
    } catch (error) {
      this.logger.error(`Error getting user positions: ${error.message}`);
      throw error;
    }
  }

  async getUserAccountData(userAddress: string): Promise<UserAccountData> {
    try {
      const accountData =
        await this.poolContract.getUserAccountData(userAddress);

      return {
        totalCollateral: ethers.utils.formatUnits(
          accountData.totalCollateralBase,
          8,
        ), // Base currency decimals
        totalDebt: ethers.utils.formatUnits(accountData.totalDebtBase, 8),
        availableBorrows: ethers.utils.formatUnits(
          accountData.availableBorrowsBase,
          8,
        ),
        currentLiquidationThreshold:
          Number(accountData.currentLiquidationThreshold) / 100,
        ltv: Number(accountData.ltv) / 100,
        healthFactor: accountData.healthFactor.eq(ethers.constants.MaxUint256)
          ? "MAX"
          : ethers.utils.formatUnits(accountData.healthFactor, 18),
      };
    } catch (error) {
      this.logger.error(`Error getting user account data: ${error.message}`);
      throw error;
    }
  }

  async stake(stakeDto: StakeDto): Promise<any> {
    const { asset, amount, userAddress } = stakeDto;

    try {
      const tokenAddress = this.blockchainService.getTokenAddress(asset);
      const decimals =
        await this.blockchainService.getTokenDecimals(tokenAddress);
      const amountWei = ethers.utils.parseUnits(amount, decimals);

      // Check balance
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        this.blockchainService.getProvider(),
      );
      const balance = await tokenContract.balanceOf(userAddress);

      if (balance.lt(amountWei)) {
        throw new BadRequestException(
          `Insufficient ${asset} balance. Have: ${ethers.utils.formatUnits(balance, decimals)}, Need: ${amount}`,
        );
      }

      // Check if auto-execute is enabled
      if (!this.blockchainService.isAutoExecuteEnabled()) {
        // Simulation mode
        return {
          success: true,
          simulation: true,
          message: `Would stake ${amount} ${asset}`,
          details: {
            asset,
            amount,
            userAddress,
            tokenAddress,
            poolAddress: this.configService.get<string>("contracts.aavePool"),
          },
        };
      }

      const signer = this.blockchainService.getSigner(userAddress);
      const poolAddress = this.configService.get<string>("contracts.aavePool");

      // Check and set allowance
      const allowance = await tokenContract.allowance(userAddress, poolAddress);
      if (allowance.lt(amountWei)) {
        this.logger.log(`Approving ${asset} for Aave Pool...`);
        
        // Add delay before approval transaction
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Estimate gas for approval
        const approveGasEstimate = await tokenContract
          .connect(signer)
          .estimateGas.approve(poolAddress, ethers.constants.MaxUint256);
        const approveGasLimit = approveGasEstimate.mul(120).div(100);
        
        const approveTx = await tokenContract
          .connect(signer)
          .approve(poolAddress, ethers.constants.MaxUint256, { gasLimit: approveGasLimit });
        await approveTx.wait();
        this.logger.log(`Approval transaction: ${approveTx.hash}`);
      }

      // Add 3-second delay before supply transaction
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Estimate gas for supply
      const estimatedGas = await this.poolContract
        .connect(signer)
        .estimateGas.supply(
          tokenAddress,
          amountWei,
          userAddress,
          0, // referral code
        );
      
      // Add 20% buffer to estimated gas
      const gasLimit = estimatedGas.mul(120).div(100);
      
      this.logger.log(`Staking ${amount} ${asset} to Aave with gas limit: ${gasLimit.toString()}...`);
      
      // Supply to Aave with custom gas limit
      const supplyTx = await this.poolContract.connect(signer).supply(
        tokenAddress,
        amountWei,
        userAddress,
        0, // referral code
        { gasLimit }
      );

      const receipt = await supplyTx.wait();
      this.logger.log(`Stake successful: ${supplyTx.hash}`);

      return {
        success: true,
        transactionHash: supplyTx.hash,
        transactionUrl: this.blockchainService.getTransactionUrl(supplyTx.hash),
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        asset,
        amount,
        userAddress,
      };
    } catch (error) {
      this.logger.error(`Stake failed: ${error.message}`);
      throw error;
    }
  }

  async withdraw(withdrawDto: WithdrawDto): Promise<any> {
    const { asset, amount, userAddress } = withdrawDto;

    try {
      const tokenAddress = this.blockchainService.getTokenAddress(asset);
      const decimals =
        await this.blockchainService.getTokenDecimals(tokenAddress);

      let amountWei: ethers.BigNumber;
      if (amount.toLowerCase() === "max") {
        // Get user's aToken balance
        const userData = await this.dataProviderContract.getUserReserveData(
          tokenAddress,
          userAddress,
        );
        amountWei = userData.currentATokenBalance;

        if (amountWei.eq(0)) {
          throw new BadRequestException(`No ${asset} to withdraw`);
        }
      } else {
        amountWei = ethers.utils.parseUnits(amount, decimals);
      }

      // Check if auto-execute is enabled
      if (!this.blockchainService.isAutoExecuteEnabled()) {
        return {
          success: true,
          simulation: true,
          message: `Would withdraw ${ethers.utils.formatUnits(amountWei, decimals)} ${asset}`,
          details: {
            asset,
            amount: ethers.utils.formatUnits(amountWei, decimals),
            userAddress,
            tokenAddress,
          },
        };
      }

      const signer = this.blockchainService.getSigner(userAddress);

      // Add 3-second delay before transaction to avoid nonce conflicts
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Estimate gas for the withdrawal
      const estimatedGas = await this.poolContract
        .connect(signer)
        .estimateGas.withdraw(tokenAddress, amountWei, userAddress);
      
      // Add 20% buffer to estimated gas
      const gasLimit = estimatedGas.mul(120).div(100);
      
      this.logger.log(
        `Withdrawing ${ethers.utils.formatUnits(amountWei, decimals)} ${asset} from Aave with gas limit: ${gasLimit.toString()}...`,
      );

      // Withdraw from Aave with custom gas limit
      const withdrawTx = await this.poolContract
        .connect(signer)
        .withdraw(tokenAddress, amountWei, userAddress, { gasLimit });

      const receipt = await withdrawTx.wait();
      this.logger.log(`Withdrawal successful: ${withdrawTx.hash}`);

      return {
        success: true,
        transactionHash: withdrawTx.hash,
        transactionUrl: this.blockchainService.getTransactionUrl(withdrawTx.hash),
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        asset,
        amount: ethers.utils.formatUnits(amountWei, decimals),
        userAddress,
      };
    } catch (error) {
      this.logger.error(`Withdrawal failed: ${error.message}`);
      throw error;
    }
  }

  async borrow(borrowDto: BorrowDto): Promise<any> {
    const { asset, amount, rateMode = 2, userAddress } = borrowDto;

    try {
      const tokenAddress = this.blockchainService.getTokenAddress(asset);
      const decimals =
        await this.blockchainService.getTokenDecimals(tokenAddress);
      const amountWei = ethers.utils.parseUnits(amount, decimals);

      // Check user's borrowing capacity
      const accountData =
        await this.poolContract.getUserAccountData(userAddress);
      if (accountData.availableBorrowsBase.eq(0)) {
        throw new BadRequestException(
          "No borrowing capacity. Supply collateral first.",
        );
      }

      // Check if auto-execute is enabled
      if (!this.blockchainService.isAutoExecuteEnabled()) {
        return {
          success: true,
          simulation: true,
          message: `Would borrow ${amount} ${asset}`,
          details: {
            asset,
            amount,
            rateMode: rateMode === 1 ? "stable" : "variable",
            userAddress,
            tokenAddress,
          },
        };
      }

      const signer = this.blockchainService.getSigner(userAddress);

      // Add 3-second delay before transaction
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Estimate gas for borrow
      const estimatedGas = await this.poolContract
        .connect(signer)
        .estimateGas.borrow(
          tokenAddress,
          amountWei,
          rateMode,
          0, // referral code
          userAddress,
        );
      
      // Add 20% buffer to estimated gas
      const gasLimit = estimatedGas.mul(120).div(100);
      
      this.logger.log(`Borrowing ${amount} ${asset} from Aave with gas limit: ${gasLimit.toString()}...`);
      
      // Borrow from Aave with custom gas limit
      const borrowTx = await this.poolContract.connect(signer).borrow(
        tokenAddress,
        amountWei,
        rateMode,
        0, // referral code
        userAddress,
        { gasLimit }
      );

      const receipt = await borrowTx.wait();
      this.logger.log(`Borrow successful: ${borrowTx.hash}`);

      return {
        success: true,
        transactionHash: borrowTx.hash,
        transactionUrl: this.blockchainService.getTransactionUrl(borrowTx.hash),
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        asset,
        amount,
        rateMode: rateMode === 1 ? "stable" : "variable",
        userAddress,
      };
    } catch (error) {
      this.logger.error(`Borrow failed: ${error.message}`);
      throw error;
    }
  }

  async repay(repayDto: RepayDto): Promise<any> {
    const { asset, amount, rateMode = 2, userAddress } = repayDto;

    try {
      const tokenAddress = this.blockchainService.getTokenAddress(asset);
      const decimals =
        await this.blockchainService.getTokenDecimals(tokenAddress);

      let amountWei: ethers.BigNumber;
      if (amount.toLowerCase() === "max") {
        amountWei = ethers.constants.MaxUint256;
      } else {
        amountWei = ethers.utils.parseUnits(amount, decimals);
      }

      // Check balance
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        this.blockchainService.getProvider(),
      );
      const balance = await tokenContract.balanceOf(userAddress);

      if (amount !== "max" && balance.lt(amountWei)) {
        throw new BadRequestException(
          `Insufficient ${asset} balance. Have: ${ethers.utils.formatUnits(balance, decimals)}, Need: ${amount}`,
        );
      }

      // Check if auto-execute is enabled
      if (!this.blockchainService.isAutoExecuteEnabled()) {
        return {
          success: true,
          simulation: true,
          message: `Would repay ${amount} ${asset}`,
          details: {
            asset,
            amount,
            rateMode: rateMode === 1 ? "stable" : "variable",
            userAddress,
            tokenAddress,
          },
        };
      }

      const signer = this.blockchainService.getSigner(userAddress);
      const poolAddress = this.configService.get<string>("contracts.aavePool");

      // Check and set allowance
      const allowance = await tokenContract.allowance(userAddress, poolAddress);
      if (allowance.lt(amountWei)) {
        this.logger.log(`Approving ${asset} for repayment...`);
        
        // Add delay before approval
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Estimate gas for approval
        const approveGasEstimate = await tokenContract
          .connect(signer)
          .estimateGas.approve(poolAddress, ethers.constants.MaxUint256);
        const approveGasLimit = approveGasEstimate.mul(120).div(100);
        
        const approveTx = await tokenContract
          .connect(signer)
          .approve(poolAddress, ethers.constants.MaxUint256, { gasLimit: approveGasLimit });
        await approveTx.wait();
      }

      // Add 3-second delay before repay transaction
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Estimate gas for repay
      const estimatedGas = await this.poolContract
        .connect(signer)
        .estimateGas.repay(tokenAddress, amountWei, rateMode, userAddress);
      
      // Add 20% buffer to estimated gas
      const gasLimit = estimatedGas.mul(120).div(100);
      
      this.logger.log(`Repaying ${amount} ${asset} to Aave with gas limit: ${gasLimit.toString()}...`);
      
      // Repay to Aave with custom gas limit
      const repayTx = await this.poolContract
        .connect(signer)
        .repay(tokenAddress, amountWei, rateMode, userAddress, { gasLimit });

      const receipt = await repayTx.wait();
      this.logger.log(`Repayment successful: ${repayTx.hash}`);

      return {
        success: true,
        transactionHash: repayTx.hash,
        transactionUrl: this.blockchainService.getTransactionUrl(repayTx.hash),
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        asset,
        amount: amount === "max" ? "All debt" : amount,
        rateMode: rateMode === 1 ? "stable" : "variable",
        userAddress,
      };
    } catch (error) {
      this.logger.error(`Repayment failed: ${error.message}`);
      throw error;
    }
  }

  async getBestStrategies(): Promise<any[]> {
    try {
      const reserves = await this.getReserves();

      // Sort by APY for supply strategies
      const supplyStrategies = reserves
        .filter((r) => r.apy > 0)
        .sort((a, b) => b.apy - a.apy)
        .slice(0, 5)
        .map((r) => ({
          type: "supply",
          asset: r.symbol,
          apy: `${r.apy.toFixed(2)}%`,
          totalSupplied: r.totalSupplied,
          availableLiquidity: r.availableLiquidity,
          canUseAsCollateral: r.usageAsCollateralEnabled,
          ltv: `${r.ltv}%`,
        }));

      // Sort by spread (supply APY - borrow APY) for leverage strategies
      const leverageStrategies = reserves
        .filter((r) => r.usageAsCollateralEnabled && r.apy > 0)
        .map((r) => ({
          asset: r.symbol,
          supplyApy: r.apy,
          borrowApy: r.borrowApy,
          spread: r.apy - r.borrowApy,
          ltv: r.ltv,
        }))
        .filter((s) => s.spread < 0) // Negative spread means borrowing costs more
        .sort((a, b) => b.spread - a.spread)
        .slice(0, 3)
        .map((s) => ({
          type: "leverage",
          description: `Supply ${s.asset}, borrow stablecoin`,
          supplyApy: `${s.supplyApy.toFixed(2)}%`,
          borrowApy: `${s.borrowApy.toFixed(2)}%`,
          netApy: `${s.spread.toFixed(2)}%`,
          maxLeverage: `${(1 / (1 - s.ltv / 100)).toFixed(1)}x`,
        }));

      return [...supplyStrategies, ...leverageStrategies];
    } catch (error) {
      this.logger.error(`Error getting strategies: ${error.message}`);
      throw error;
    }
  }
}
