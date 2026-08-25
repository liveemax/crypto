import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SnapshotService } from '../core/fetch/snapshot.service';
import { RefreshSnapshotDto, SnapshotQueryDto, SnapshotRowDto } from './dto/snapshot.dto';
import { UniverseService } from '../core/universe/universe.service';

@ApiTags('snapshot')
@Controller('snapshot')
export class SnapshotController {
  constructor(
    private readonly snapshots: SnapshotService,
    private readonly universe: UniverseService,
  ) {}

  @Post('refresh')
  @ApiOperation({ summary: 'Обновить данные выбранных токенов или всей рабочей вселенной' })
  @ApiBody({ type: RefreshSnapshotDto, required: false })
  async refresh(@Body() body: RefreshSnapshotDto = {}) {
    const universe = await this.universe.ensureFresh();
    if (universe.started) {
      return { rows: 0, withErrors: 0, errors: [], universe };
    }
    const rows = await this.snapshots.build(body.tickers);
    const errors = rows.filter((r) => r.errors.length > 0).map((r) => ({ ticker: r.ticker, errors: r.errors }));
    return { rows: rows.length, withErrors: errors.length, errors, universe };
  }

  @Get()
  @ApiOperation({ summary: 'Получить последний снапшот' })
  @ApiOkResponse({ type: SnapshotRowDto, isArray: true })
  latest() { return this.snapshots.latest(); }

  @Get(':token')
  @ApiOperation({ summary: 'Получить данные одного токена' })
  @ApiOkResponse({ type: SnapshotRowDto })
  row(@Param('token') token: string, @Query() query: SnapshotQueryDto) {
    return this.snapshots.getRow(token, query);
  }
}
