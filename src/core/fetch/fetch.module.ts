import { Module } from "@nestjs/common";
import { SnapshotController } from "../../api/snapshot.controller";
import { StoreService } from "../store/store.service";
import { CoingeckoService } from "./coingecko.service";
import { DefillamaService } from "./defillama.service";
import { SnapshotService } from "./snapshot.service";

@Module({
  controllers: [SnapshotController],
  providers: [
    StoreService,
    CoingeckoService,
    DefillamaService,
    SnapshotService,
  ],
  exports: [SnapshotService],
})
export class FetchModule {}
