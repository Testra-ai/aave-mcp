import { Module } from '@nestjs/common';
import { OneInchService } from './one-inch.service';
import { BlockchainModule } from '../blockchain/blockchain.module';

@Module({
  imports: [BlockchainModule],
  providers: [OneInchService],
  exports: [OneInchService],
})
export class OneInchModule {}