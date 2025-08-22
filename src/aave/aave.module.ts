import { Module } from "@nestjs/common";
import { AaveService } from "./aave.service";
import { BlockchainModule } from "../blockchain/blockchain.module";

@Module({
  imports: [BlockchainModule],
  providers: [AaveService],
  exports: [AaveService],
})
export class AaveModule {}
