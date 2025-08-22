import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AaveModule } from "./aave/aave.module";
import { SwapModule } from "./swap/swap.module";
import { BlockchainModule } from "./blockchain/blockchain.module";
import { McpModule } from "./mcp/mcp.module";
import { SmartDepositModule } from "./smart-deposit/smart-deposit.module";
import { TransactionBuilderModule } from "./transaction-builder/transaction-builder.module";
import { OneInchModule } from "./one-inch/one-inch.module";
import configuration from "./config/configuration";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    BlockchainModule,
    AaveModule,
    SwapModule,
    McpModule,
    SmartDepositModule,
    TransactionBuilderModule,
    OneInchModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
