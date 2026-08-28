import { Module } from '@nestjs/common';
import { TokenomicsController } from '../../api/tokenomics.controller';
import { CoreModule } from '../core.module';
import { ManualModule } from '../manual/manual.module';
import { UniverseModule } from '../universe/universe.module';
import { EmissionsService } from './emissions.service';
import { TokenomicsService } from './tokenomics.service';

@Module({
  imports: [CoreModule, UniverseModule, ManualModule],
  controllers: [TokenomicsController],
  providers: [EmissionsService, TokenomicsService],
  exports: [TokenomicsService],
})
export class TokenomicsModule {}