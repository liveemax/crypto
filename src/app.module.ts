import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentsModule } from './agents/agents.module';
import { AppConfigModule } from './config/config.module';
import { EvaluationModule } from './core/evaluation/evaluation.module';
import { FetchModule } from './core/fetch/fetch.module';
import { ManualModule } from './core/manual/manual.module';
import { TokenomicsModule } from './core/tokenomics/tokenomics.module';
import { UniverseModule } from './core/universe/universe.module';
import { HealthController } from './health/health.controller';
import { CoreModule } from './core/core.module';
import { JobsModule } from './core/jobs/jobs.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CoreModule,
    AppConfigModule,
    UniverseModule,
    ManualModule,
    TokenomicsModule,
    EvaluationModule,
    FetchModule,
    AgentsModule,
    JobsModule
  ],
  controllers: [HealthController],
})
export class AppModule {}
