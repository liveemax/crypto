import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SnapshotService } from "../core/fetch/snapshot.service";
import {
  RefreshSnapshotDto,
  SnapshotQueryDto,
  SnapshotRowDto,
} from "./dto/snapshot.dto";

@ApiTags("snapshot")
@Controller("snapshot")
export class SnapshotController {
  constructor(private readonly snapshots: SnapshotService) {}

  @Post("refresh")
  @ApiOperation({
    summary: "Обновить данные выбранных токенов или всей вселенной",
  })
  @ApiBody({ type: RefreshSnapshotDto, required: false })
  async refresh(@Body() body: RefreshSnapshotDto = {}) {
    const rows = await this.snapshots.build(body.tickers);
    const errors = rows
      .filter((row) => row.errors.length > 0)
      .map((row) => ({ ticker: row.ticker, errors: row.errors }));
    return { rows: rows.length, withErrors: errors.length, errors };
  }

  @Get()
  @ApiOperation({ summary: "Получить последний снапшот" })
  @ApiOkResponse({ type: SnapshotRowDto, isArray: true })
  latest() {
    return this.snapshots.latest();
  }

  @Get(":token")
  @ApiOperation({ summary: "Получить данные одного токена" })
  @ApiOkResponse({ type: SnapshotRowDto })
  row(@Param("token") token: string, @Query() query: SnapshotQueryDto) {
    return this.snapshots.getRow(token, query);
  }
}
