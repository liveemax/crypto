import { Module } from '@nestjs/common';
import { AgentsController } from '../api/agents.controller';
import { CoreModule } from '../core/core.module';
import { FetchModule } from '../core/fetch/fetch.module';
import { AgentRunnerService } from './agent-runner.service';

/**
 * Реестр агентов пуст до шага 13. Это законное состояние, а не сбой сборки:
 * valuation, tokenomics и sectorPosition агентами не являются и считаются одним
 * массовым прогоном в core/evaluation.
 */
@Module({
  imports: [CoreModule, FetchModule],
  controllers: [AgentsController],
  providers: [AgentRunnerService],
  exports: [AgentRunnerService],
})
export class AgentsModule {}