import { Module } from '@nestjs/common';
import { CoreModule } from '../core.module';
import { UniverseBuilder } from './universe.builder';
import { UniverseFilter } from './universe.filter';
import { UniverseService } from './universe.service';
import { UniverseController } from './universe.controller';

@Module({
  imports: [CoreModule],
  controllers: [UniverseController],
  providers: [UniverseBuilder, UniverseFilter, UniverseService],
  exports: [UniverseService],
})
export class UniverseModule {}
