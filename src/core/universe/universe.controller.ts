import { Body, Controller, Get, NotFoundException, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  UniverseCompareResponseDto,
  FunnelReportDto,
  RefreshUniverseDto,
  RefreshUniverseResponseDto,
  UniverseCandidateDto,
  UniverseQueryDto,
  UniverseScreenResponseDto,
  UniverseStatusDto,
} from './universe.dto';
import { CompareUniverseDto, ProfileSelectionDto } from './profile.dto';
import { UniverseService } from './universe.service';
import { ProfileReference, ProfileSelection, UniverseCandidate } from './universe.types';

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

  @Post('prices')
  @ApiOperation({
    summary: 'Обновить числа без изменения состава вселенной',
    description:
      'Загружает рынок CoinGecko и три сводки комиссий DeFiLlama. ' +
      'Версия и builtAt состава не меняются.',
  })
  @ApiOkResponse({ type: UniverseScreenResponseDto })
  async prices(): Promise<UniverseScreenResponseDto> {
    return this.universe.refreshPrices();
  }

  @Post('screen')
  @ApiOperation({
    summary: 'Применить профиль к сохранённой вселенной без сети',
    description:
      'Принимает profileId встроенного профиля или полный разовый profile. ' +
      'Сохранённый снимок не изменяется.',
  })
  @ApiBody({ type: ProfileSelectionDto, required: false })
  @ApiOkResponse({ type: UniverseScreenResponseDto })
  async screen(
    @Body() body: ProfileSelectionDto = {},
  ): Promise<UniverseScreenResponseDto> {
    return this.universe.screen(body as unknown as ProfileSelection);
  }

  @Post('compare')
  @ApiOperation({ summary: 'Сравнить два профиля на одном снимке без сети' })
  @ApiOkResponse({ type: UniverseCompareResponseDto })
  async compare(
    @Body() body: CompareUniverseDto,
  ): Promise<UniverseCompareResponseDto> {
    return this.universe.compare(
      body.left as unknown as ProfileReference,
      body.right as unknown as ProfileReference,
    );
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
