import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';
import { FetchModule } from './core/fetch/fetch.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), AppConfigModule, FetchModule],
  controllers: [HealthController],
})
export class AppModule {}
