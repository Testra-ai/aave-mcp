import { Module } from "@nestjs/common";
import { SwapService } from "./swap.service";
import { AdvancedSwapService } from "./advanced-swap.service";
import { AaveModule } from "../aave/aave.module";
import { BlockchainModule } from "../blockchain/blockchain.module";
import { OneInchModule } from "../one-inch/one-inch.module";

@Module({
  imports: [AaveModule, BlockchainModule, OneInchModule],
  providers: [SwapService, AdvancedSwapService],
  exports: [SwapService, AdvancedSwapService],
})
export class SwapModule {}
