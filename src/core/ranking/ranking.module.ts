import { Module } from '@nestjs/common';
import { RankingController } from '../../api/ranking.controller';
import { CoreModule } from '../core.module';
import { EvaluationModule } from '../evaluation/evaluation.module';
import { RankingService } from './ranking.service';

@Module({
  imports: [CoreModule, EvaluationModule],
  controllers: [RankingController],
  providers: [RankingService],
  exports: [RankingService],
})
export class RankingModule {}
