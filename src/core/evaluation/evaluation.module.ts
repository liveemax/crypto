import { Module } from '@nestjs/common';
import { EvaluationController } from '../../api/evaluation.controller';
import { CoreModule } from '../core.module';
import { UniverseModule } from '../universe/universe.module';
import { EvaluationService } from './evaluation.service';

@Module({
  imports: [CoreModule, UniverseModule],
  controllers: [EvaluationController],
  providers: [EvaluationService],
  exports: [EvaluationService],
})
export class EvaluationModule {}