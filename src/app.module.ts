import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppConfigModule } from './config/config.module';
import { ApiExceptionFilter } from './api/http/api-exception.filter';
import { EvaluationModule } from './core/evaluation/evaluation.module';
import { ManualModule } from './core/manual/manual.module';
import { RankingModule } from './core/ranking/ranking.module';
import { SystemModule } from './core/system/system.module';
import { TokenomicsModule } from './core/tokenomics/tokenomics.module';
import { UniverseModule } from './core/universe/universe.module';
import { HealthController } from './health/health.controller';
import { CoreModule } from './core/core.module';
import { JobsModule } from './core/jobs/jobs.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CoreModule,
    JobsModule,
    AppConfigModule,
    UniverseModule,
    ManualModule,
    TokenomicsModule,
    EvaluationModule,
    RankingModule,
    // Последним намеренно: его GET /universe/{token} обязан регистрироваться
    // после литеральных маршрутов UniverseController, иначе :token перехватит
    // /universe/status, /universe/funnel, /universe/coverage и /universe/data-gaps.
    SystemModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}