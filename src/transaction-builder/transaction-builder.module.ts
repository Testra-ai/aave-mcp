import { Module } from '@nestjs/common';
import { TransactionBuilderService } from './transaction-builder.service';
import { BlockchainModule } from '../blockchain/blockchain.module';

@Module({
  imports: [BlockchainModule],
  providers: [TransactionBuilderService],
  exports: [TransactionBuilderService],
})
export class TransactionBuilderModule {}