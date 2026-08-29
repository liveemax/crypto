import { Module } from '@nestjs/common';
import { EvaluationController } from '../../api/evaluation.controller';
import { CoreModule } from '../core.module';
import { ManualModule } from '../manual/manual.module';
import { UniverseModule } from '../universe/universe.module';
import { EvaluationService } from './evaluation.service';

@Module({
  imports: [CoreModule, UniverseModule, ManualModule],
  controllers: [EvaluationController],
  providers: [EvaluationService],
  exports: [EvaluationService],
})
export class EvaluationModule {}