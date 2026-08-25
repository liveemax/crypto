import { Body, Controller, Get, NotFoundException, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FunnelReportDto,
  RefreshUniverseDto,
  RefreshUniverseResponseDto,
  UniverseCandidateDto,
  UniverseQueryDto,
  UniverseStatusDto,
} from './universe.dto';
import { UniverseService } from './universe.service';
import { UniverseCandidate } from './universe.types';

type SortKey = 'rank' | 'holderYieldPct' | 'revenue12mUsd' | 'pRev';

@ApiTags('universe')
@Controller('universe')
export class UniverseController {
  constructor(private readonly universe: UniverseService) {}

  @Post('refresh')
  @ApiOperation({
    summary: 'Пересобрать состав вселенной',
    description:
      'Без force пересборка идёт только если состав старше месяца. ' +
      'force можно передать и в теле, и в query — второе удобнее в Swagger. ' +
      'Работа идёт в фоне, счётчик — в GET /universe/status.',
  })
  @ApiBody({ type: RefreshUniverseDto, required: false })
  @ApiOkResponse({ type: RefreshUniverseResponseDto })
  async refresh(
    @Query() query: RefreshUniverseDto,
    @Body() body: RefreshUniverseDto = {},
  ): Promise<RefreshUniverseResponseDto> {
    return this.universe.ensureFresh({
      force: query.force ?? body.force,
      topN: query.topN ?? body.topN,
    });
  }

  @Get('status')
  @ApiOperation({ summary: 'Счётчик пересборки и сводка последнего состава' })
  @ApiOkResponse({ type: UniverseStatusDto })
  async status(): Promise<UniverseStatusDto> {
    return this.universe.status();
  }

  @Get('funnel')
  @ApiOperation({
    summary: 'Воронка отсева: сколько кандидатов отпало на каждой проверке',
  })
  @ApiOkResponse({ type: FunnelReportDto })
  async funnel(): Promise<FunnelReportDto> {
    const snapshot = await this.universe.latest();
    if (!snapshot) {
      throw new NotFoundException(
        'Вселенная ещё не собрана. Вызовите POST /universe/refresh',
      );
    }
    return snapshot.funnel;
  }

  @Get()
  @ApiOperation({ summary: 'Состав вселенной с тирами и причинами отсева' })
  @ApiOkResponse({ type: UniverseCandidateDto, isArray: true })
  async list(@Query() query: UniverseQueryDto): Promise<UniverseCandidateDto[]> {
    const snapshot = await this.universe.latest();
    if (!snapshot) {
      throw new NotFoundException(
        'Вселенная ещё не собрана. Вызовите POST /universe/refresh',
      );
    }
    const passedOnly = query.passedOnly ?? true;
    const sector = query.sector?.trim().toLowerCase();
    const sort = (query.sort ?? 'rank') as SortKey;

    return snapshot.candidates
      .filter((item) => (passedOnly ? item.passed : true))
      .filter((item) => (query.tier ? item.tier === query.tier : true))
      .filter((item) => (sector ? item.sector === sector : true))
      .sort(comparator(sort))
      .slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 100));
  }
}

/** rank сортируется по возрастанию, финансовые метрики — по убыванию. */
function comparator(
  sort: SortKey,
): (left: UniverseCandidate, right: UniverseCandidate) => number {
  if (sort === 'rank') return (left, right) => left.rank - right.rank;
  if (sort === 'pRev') {
    return (left, right) => (left.pRev ?? Infinity) - (right.pRev ?? Infinity);
  }
  return (left, right) => (right[sort] ?? -Infinity) - (left[sort] ?? -Infinity);
}
