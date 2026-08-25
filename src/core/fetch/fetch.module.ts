import { Module } from '@nestjs/common';
import { SnapshotController } from '../../api/snapshot.controller';
import { CoreModule } from '../core.module';
import { UniverseModule } from '../universe/universe.module';
import { SnapshotService } from './snapshot.service';

@Module({
  imports: [CoreModule, UniverseModule],
  controllers: [SnapshotController],
  providers: [SnapshotService],
  exports: [SnapshotService],
})
export class FetchModule {}
