import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigModule } from './config/config.module';
import { FetchModule } from './core/fetch/fetch.module';
import { UniverseModule } from './core/universe/universe.module';
import { HealthController } from './health/health.controller';
import { CoreModule } from './core/core.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CoreModule,
    AppConfigModule,
    UniverseModule,
    FetchModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
