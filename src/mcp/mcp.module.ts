import { Module } from "@nestjs/common";
import { McpController } from "./mcp.controller";
import { McpService } from "./mcp.service";
import { AaveModule } from "../aave/aave.module";
import { SwapModule } from "../swap/swap.module";
import { BlockchainModule } from "../blockchain/blockchain.module";
import { SmartDepositModule } from "../smart-deposit/smart-deposit.module";
import { TransactionBuilderModule } from "../transaction-builder/transaction-builder.module";
import { OneInchModule } from "../one-inch/one-inch.module";

@Module({
  imports: [AaveModule, SwapModule, BlockchainModule, SmartDepositModule, TransactionBuilderModule, OneInchModule],
  controllers: [McpController],
  providers: [McpService],
  exports: [McpService],
})
export class McpModule {}
