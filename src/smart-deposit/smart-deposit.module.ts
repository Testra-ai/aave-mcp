import { Module } from '@nestjs/common';
import { SmartDepositService } from './smart-deposit.service';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { SwapModule } from '../swap/swap.module';
import { AaveModule } from '../aave/aave.module';

@Module({
  imports: [BlockchainModule, SwapModule, AaveModule],
  providers: [SmartDepositService],
  exports: [SmartDepositService],
})
export class SmartDepositModule {}