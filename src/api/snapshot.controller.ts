import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
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
  @ApiOperation({
    summary: 'Строки снапшота — то, что пойдёт на вход агентам',
    description:
      'Отличие от GET /universe: там кандидаты вселенной, сырьё со всеми рыночными ' +
      'числами и склейкой. Здесь SnapshotRow — приведённые метрики со временем каждого ' +
      'источника и universeVersion, вход шагов 08–14.\n\n' +
      'Отдаётся страницами: limit по умолчанию 50, максимум 500.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiOkResponse({ type: SnapshotRowDto, isArray: true })
  async latest(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    const rows = (await this.snapshots.latest()) ?? [];
    const size = Number(limit);
    const from = Number(offset);
    const take = Number.isFinite(size) && size > 0 ? Math.min(size, 500) : 50;
    const skip = Number.isFinite(from) && from > 0 ? from : 0;
    return Array.isArray(rows) ? rows.slice(skip, skip + take) : rows;
  }

  @Get(':token')
  @ApiOperation({ summary: 'Получить данные одного токена' })
  @ApiOkResponse({ type: SnapshotRowDto })
  row(@Param('token') token: string, @Query() query: SnapshotQueryDto) {
    return this.snapshots.getRow(token, query);
  }
}
