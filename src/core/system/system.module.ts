import { Module } from '@nestjs/common';
import { StatusController } from '../../api/status.controller';
import { TokenController } from '../../api/token.controller';
import { EvaluationModule } from '../evaluation/evaluation.module';
import { UniverseModule } from '../universe/universe.module';
import { StatusService } from './status.service';
import { TokenService } from './token.service';

/**
 * Слой над остальными: GET /status и GET /universe/{token} читают и вселенную,
 * и оценку сразу. Обратный импорт из UniverseModule дал бы цикл, поэтому оба
 * контроллера живут здесь. Модуль импортируется последним — см. app.module.ts.
 */
@Module({
  imports: [UniverseModule, EvaluationModule],
  controllers: [StatusController, TokenController],
  providers: [StatusService, TokenService],
})
export class SystemModule {}