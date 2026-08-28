import { Module } from '@nestjs/common';
import { ManualController } from '../../api/manual.controller';
import { CoreModule } from '../core.module';
import { UniverseModule } from '../universe/universe.module';
import { ManualService } from './manual.service';

@Module({
  imports: [CoreModule, UniverseModule],
  controllers: [ManualController],
  providers: [ManualService],
  exports: [ManualService],
})
export class ManualModule {}