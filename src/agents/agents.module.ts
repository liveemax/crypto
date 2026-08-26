import { Module } from '@nestjs/common';
import { AgentsController } from '../api/agents.controller';
import { CoreModule } from '../core/core.module';
import { FetchModule } from '../core/fetch/fetch.module';
import { AgentRunnerService } from './agent-runner.service';
import { AGENT } from './agents.constants';
import { ScreenerAgent } from './screener.agent';

/**
 * Реестр агентов собирается в одном DI-провайдере: Nest не поддерживает multi
 * providers, поэтому новые реализации добавляются только в фабрику массива.
 */
@Module({
  imports: [CoreModule, FetchModule],
  controllers: [AgentsController],
  providers: [
    ScreenerAgent,
    { provide: AGENT, useFactory: (screener: ScreenerAgent) => [screener], inject: [ScreenerAgent] },
    AgentRunnerService,
  ],
  exports: [AgentRunnerService],
})
export class AgentsModule {}
