import { Module } from '@nestjs/common';
import { AgentsController } from '../api/agents.controller';
import { CoreModule } from '../core/core.module';
import { FetchModule } from '../core/fetch/fetch.module';
import { AgentRunnerService } from './agent-runner.service';

/**
 * Агенты добавляются сюда по одному как { provide: AGENT, useClass: X, multi: true }
 * на шагах 08–14. Реестр пуст — сервис собирается и отвечает пустым списком.
 */
@Module({
  imports: [CoreModule, FetchModule],
  controllers: [AgentsController],
  providers: [AgentRunnerService],
  exports: [AgentRunnerService],
})
export class AgentsModule {}