import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AnalysisProfileDto } from './profile.dto';
import { ActiveFilterStateDto } from './filter-state.dto';
import { AlphaDataGapDto, AlphaSectorSummaryDto, AlphaViewDto } from './alpha.dto';

/** Сохраняет undefined: иначе отсутствующий флаг превращается в явный false. */
const toBoolean = ({ value }: { value: unknown }): boolean | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  return value === true || value === 'true' || value === '1';
};

export class RefreshUniverseDto {
  @ApiPropertyOptional({
    description: 'Пересобрать состав даже если он свежее месяца',
    example: true,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional({
    description: 'Сколько токенов оставить в пуле кандидатов',
    example: 1300,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(20_000)
  topN?: number;
}

export class UniverseQueryDto {
  @ApiPropertyOptional({ description: 'Только прошедшие шлак-фильтр', default: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  passedOnly?: boolean;

  @ApiPropertyOptional({
    description:
      'yield — выручка доходит до держателей; economics — выручка есть; ' +
      'pool — данных нет; rejected — отсеян',
    enum: ['yield', 'economics', 'pool', 'rejected'],
  })
  @IsOptional()
  @IsIn(['yield', 'economics', 'pool', 'rejected'])
  tier?: string;

  @ApiPropertyOptional({ description: 'Фильтр по сектору', example: 'lending' })
  @IsOptional()
  @IsString()
  sector?: string;

  @ApiPropertyOptional({
    description: 'Сортировка по убыванию',
    enum: ['rank', 'holderYieldPct', 'revenue12mUsd', 'pRev'],
    default: 'rank',
  })
  @IsOptional()
  @IsIn(['rank', 'holderYieldPct', 'revenue12mUsd', 'pRev'])
  sort?: string;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_000)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

}

export class UniverseCandidateDto {
  @ApiProperty({ example: 12 }) rank!: number;
  @ApiProperty({ example: 'aave' }) coingeckoId!: string;
  @ApiProperty({ example: 'AAVE' }) ticker!: string;
  @ApiProperty({ example: 'Aave' }) name!: string;

  // Разлоки. Пример согласован с одной монетой: circulating 5 млрд,
  // доходность держателя 0.5%, суточный объём 123 млн.
  @ApiProperty({
    nullable: true,
    example: 118.6,
    description: 'Навес: (totalSupply − circulating) / circulating. Сколько может выйти, но не когда',
  })
  overhangPct!: number | null;
  @ApiProperty({ nullable: true, example: 37, description: 'Событий и потоков впереди' })
  unlockEventsCount!: number | null;
  @ApiProperty({ nullable: true, example: 92_650_000 }) unlockTokens30d!: number | null;
  @ApiProperty({ nullable: true, example: 277_950_000 }) unlockTokens90d!: number | null;
  @ApiProperty({ nullable: true, example: 1_112_000_000 }) unlockTokens365d!: number | null;
  @ApiProperty({ nullable: true, example: 1.85 }) unlock30dPct!: number | null;
  @ApiProperty({ nullable: true, example: 5.56 }) unlock90dPct!: number | null;
  @ApiProperty({ nullable: true, example: 22.24 }) unlock12mPct!: number | null;
  @ApiProperty({
    nullable: true,
    example: -21.74,
    description:
      'Доходность держателя минус разводнение за 12 месяцев. null — известна ' +
      'только одна половина: разность из одной половины это не оценка',
  })
  netHolderYieldPct!: number | null;
  @ApiProperty({
    nullable: true,
    example: '2026-09-16T00:00:00.000Z',
    description: 'Ближайший клифф. Линейный поток дискретного события не имеет',
  })
  nextUnlockAt!: string | null;
  @ApiProperty({ nullable: true, example: 41_800_000 }) nextUnlockUsd!: number | null;
  @ApiProperty({
    nullable: true,
    example: 0.34,
    description: 'Разлок на 3 дневных объёма и на 30 — принципиально разные события',
  })
  nextUnlockCostInDailyVolumes!: number | null;
  @ApiProperty({
    nullable: true,
    example: 0,
    description: 'Доля эмиссии без расписания. Выше 5% число не принимается',
  })
  tokenomicsTbdPct!: number | null;
  @ApiProperty({
    enum: [
      'available',
      'known_zero',
      'mapping_failed',
      'source_missing',
      'source_stale',
      'source_error',
      'matched_unparsed',
    ],
    example: 'available',
    description:
      'known_zero — ноль измерен полным расписанием; source_missing — источник ' +
      'токен не знает; matched_unparsed — документ есть, но число из него не ' +
      'берётся. Ни одно из этих состояний не равно нулю разлоков',
  })
  tokenomicsState!: string;
  @ApiProperty({ nullable: true, example: 'https://defillama.com/unlocks/arbitrum' })
  tokenomicsSource!: string | null;
  @ApiProperty({
    nullable: true,
    example: '2026-08-26T04:12:07.000Z',
    description: 'Время источника (last-modified датасета), а не время нашего запроса',
  })
  asOfTokenomics!: string | null;
  @ApiProperty({ nullable: true }) priceUsd!: number | null;
  @ApiProperty({ nullable: true }) circulating!: number | null;
  @ApiProperty({ nullable: true }) totalSupply!: number | null;
  @ApiProperty({
    nullable: true,
    description: 'Капитализация, посчитанная кодом: price × circulating',
  })
  mcapCalcUsd!: number | null;
  @ApiProperty({ nullable: true, description: 'Капитализация CoinGecko — для сверки' })
  mcapReportedUsd!: number | null;
  @ApiProperty({ nullable: true }) mcapDivergencePct!: number | null;
  @ApiProperty({ nullable: true }) fdvUsd!: number | null;
  @ApiProperty({ nullable: true }) vol24hUsd!: number | null;
  @ApiProperty({ nullable: true, description: 'Оборот за сутки в % от капитализации' })
  turnoverPct!: number | null;
  @ApiProperty({ nullable: true, description: 'Доля эмиссии в обращении, %' })
  floatPct!: number | null;
  @ApiProperty({ nullable: true, description: 'Во сколько раз FDV больше капитализации' })
  fdvToMcap!: number | null;
  @ApiProperty({ nullable: true }) marketSource!: string | null;
  @ApiProperty({ nullable: true, example: '2026-08-24T17:48:30.000Z' })
  marketAsOf!: string | null;

  @ApiProperty({ type: [String], example: ['aave-v3', 'aave-v2'] })
  defillamaSlugs!: string[];
  @ApiProperty({
    nullable: true,
    example: 'lending',
    description: 'Категория DeFiLlama как пришла: способ зарабатывать',
  })
  sector!: string | null;
  @ApiProperty({ type: [String], example: ['layer-1'], description: 'Категории CoinGecko из карты' })
  rawSectors!: string[];
  @ApiProperty({
    nullable: true,
    example: 'lending',
    description:
      'Группа прямых конкурентов, по ней сравнивает альфа. null — пробел покрытия, ' +
      'а не вердикт о токене',
  })
  comparisonGroup!: string | null;
  @ApiProperty({
    enum: ['protocol', 'chain', 'exchange', 'infrastructure', 'other'],
    example: 'protocol',
  })
  assetArchetype!: string;
  @ApiProperty({
    enum: ['available', 'known_zero', 'mapping_failed', 'source_missing', 'source_stale', 'unsupported_business_model'],
    example: 'available',
    description:
      'known_zero — ноль измерен и подтверждён, это не пробел. ' +
      'unsupported_business_model — сеть платит валидаторам, а не держателю',
  })
  revenueState!: string;
  @ApiProperty({
    enum: ['gecko_id', 'symbol', 'chain', 'override', 'none'],
    description:
      'Как нашли протокол: gecko_id — прямая ссылка от DeFiLlama; symbol — по тикеру ' +
      'группы версий, когда gecko_id пуст у всех; chain — сеть по имени; ' +
      'override — вручную в discovery.ts; none — не нашли, экономики нет',
  })
  matchedBy!: string;
  @ApiProperty({ nullable: true }) tvlUsd!: number | null;
  @ApiProperty({ nullable: true }) tvlSource!: string | null;

  @ApiProperty({ nullable: true, description: 'Комиссии пользователей за 12 месяцев' })
  fees12mUsd!: number | null;
  @ApiProperty({
    nullable: true,
    description: 'Валовая прибыль: комиссии минус выплаты поставщикам капитала',
  })
  revenue12mUsd!: number | null;
  @ApiProperty({
    nullable: true,
    description: 'Дошло до держателей токена: выкуп, стейкинг из комиссий, fee switch',
  })
  holdersRevenue12mUsd!: number | null;
  @ApiProperty({ nullable: true }) revenue30dUsd!: number | null;
  @ApiProperty({ nullable: true }) holdersRevenue30dUsd!: number | null;
  @ApiProperty({ enum: ['reported_1y', 'run_rate_30d', 'none'] }) revenueBasis!: string;
  @ApiProperty({ nullable: true }) revenueSource!: string | null;
  @ApiProperty({ description: 'false — адаптер DeFiLlama сломан' })
  sourceHealthy!: boolean;

  @ApiProperty({
    nullable: true,
    example: 5.5,
    description: 'Доходность держателя: holdersRevenue за 12м к капитализации, %',
  })
  holderYieldPct!: number | null;
  @ApiProperty({ nullable: true, description: 'Доля комиссий, остающаяся протоколу, %' })
  takeRatePct!: number | null;
  @ApiProperty({ nullable: true, description: 'Доля выручки, дошедшая до держателей, %' })
  payoutRatioPct!: number | null;
  @ApiProperty({ nullable: true, example: 10.3 }) pRev!: number | null;
  @ApiProperty({ nullable: true }) pFees!: number | null;
  @ApiProperty({ nullable: true }) fdvRev!: number | null;
  @ApiProperty({ nullable: true }) revenuePerTvlPct!: number | null;

  @ApiProperty({ enum: ['yield', 'economics', 'pool', 'rejected'] }) tier!: string;
  @ApiProperty({ example: true }) passed!: boolean;
  @ApiProperty({
    nullable: true,
    example: 'turnover',
    description: 'Стадия отсева: у screen это правило воронки, у альфы — её решение',
  })
  rejectedAt!: string | null;
  @ApiProperty({ nullable: true }) rejectReason!: string | null;
  @ApiProperty({
    type: AlphaViewDto,
    nullable: true,
    description: 'null — фильтр альфы выключен: сравнения не было, а не «сравнили и никак»',
  })
  alpha!: AlphaViewDto | null;
}
export class FunnelStageDto {
  @ApiProperty({
    enum: ['screen', 'alpha'],
    example: 'screen',
    description: 'Какой фильтр отсеял: без виновника отсев по данным неотличим от отсева по существу',
  })
  filter!: string;
  @ApiProperty({ example: 'turnover' }) stage!: string;
  @ApiProperty({ example: 'Оборот не ниже 0.1% капитализации за сутки' }) label!: string;
  @ApiProperty({ example: 1_150 }) incoming!: number;
  @ApiProperty({ example: 180 }) dropped!: number;
  @ApiProperty({ example: 970 }) kept!: number;
}

export class FunnelTiersDto {
  @ApiProperty({ example: 83, description: 'Выручка доходит до держателей токена' })
  yield!: number;
  @ApiProperty({ example: 85, description: 'Выручка есть, до держателей не доходит' })
  economics!: number;
  @ApiProperty({ example: 439, description: 'Шлак-фильтр пройден, финансовых данных нет' })
  pool!: number;
  @ApiProperty({ example: 693 }) rejected!: number;
}

export class FunnelReportDto {
  @ApiProperty({ example: 1_300 }) total!: number;
  @ApiProperty({ type: FunnelStageDto, isArray: true }) stages!: FunnelStageDto[];
  @ApiProperty({ example: 607 }) passed!: number;
  @ApiProperty({ type: FunnelTiersDto }) tiers!: FunnelTiersDto;
}

/**
 * Воронка вместе с происхождением. Внутри ответов screen и compare эти три поля
 * не нужны — там снимок и профиль названы на верхнем уровне. Нужны они там, где
 * воронка приходит сама по себе: иначе «605» не отличить от «605 другого отбора
 * по другому снимку».
 */
export class FunnelViewDto extends FunnelReportDto {
  @ApiProperty({
    example: '2026-08-25',
    description: 'Версия вселенной, по которой считалась воронка',
  })
  universeVersion!: string;
  @ApiProperty({ example: '2026-08-25T11:43:55.725Z' }) builtAt!: string;
  @ApiProperty({
    type: ActiveFilterStateDto,
    description: 'Чья это воронка. Мнение композиции фильтров о снимке, а не свойство снимка',
  })
  activeFilters!: ActiveFilterStateDto;
}

export class UniverseProgressDto {
  @ApiProperty({
    enum: [
      'idle', 'markets', 'categories', 'protocols', 'chains',
      'fees', 'prices', 'join', 'filter', 'save', 'done', 'failed',
    ],
  })
  step!: string;
  @ApiProperty({ example: 'Рынок CoinGecko' }) label!: string;
  @ApiProperty({ example: 4 }) current!: number;
  @ApiProperty({ example: 6 }) total!: number;
  @ApiProperty({ example: 67 }) percent!: number;
  @ApiProperty({ example: 1_000, description: 'Строк загружено' }) loaded!: number;
  @ApiProperty({ example: 0, description: 'Запросов завершилось ошибкой' })
  failures!: number;
  @ApiProperty({ nullable: true, example: null }) lastError!: string | null;
  @ApiProperty({ nullable: true, example: '2026-08-25T11:40:12.000Z' })
  startedAt!: string | null;
  @ApiProperty({ example: 48 }) elapsedSec!: number;
  @ApiProperty({ nullable: true, example: null }) etaSec!: number | null;
}

export class UniverseStatusDto {
  @ApiProperty({ enum: ['idle', 'running', 'error'], example: 'idle' }) state!: string;
  @ApiProperty({ type: UniverseProgressDto }) progress!: UniverseProgressDto;
  @ApiProperty({ nullable: true, example: null }) error!: string | null;
  @ApiProperty({ nullable: true, example: '2026-08-25' }) version!: string | null;
  @ApiProperty({ nullable: true, example: 0 }) ageDays!: number | null;
  @ApiProperty({ nullable: true, example: 1_300 }) total!: number | null;
  @ApiProperty({
    nullable: true,
    example: 607,
    description:
      'Прошло все включённые фильтры. Ни один не включён — равно total: ' +
      'вселенная без фильтров это вся вселенная',
  })
  passed!: number | null;
  @ApiProperty({ type: FunnelTiersDto, nullable: true }) tiers!: FunnelTiersDto | null;
  @ApiProperty({
    type: ActiveFilterStateDto,
    description: 'Чем получены passed и tiers. Композиция независимых фильтров, а не одно имя',
  })
  activeFilters!: ActiveFilterStateDto;
  @ApiProperty({
    nullable: true,
    example: 'deep-value',
    deprecated: true,
    description: 'Алиас activeFilters.screen.profileId. Источник истины — activeFilters',
  })
  profileId!: string | null;
}
export class RefreshUniverseResponseDto {
  @ApiProperty({ example: true }) started!: boolean;
  @ApiProperty({
    enum: ['fresh', 'stale', 'never_built', 'already_running', 'forced'],
  })
  reason!: string;
  @ApiProperty({ nullable: true, example: 0 }) ageDays!: number | null;
  @ApiProperty({ example: 'Пересборка запущена в фоне' }) message!: string;
}

export class ScreenApplyResponseDto {
  @ApiProperty({ example: '2026-08-25' }) universeVersion!: string;
  @ApiProperty({ example: '2026-08-25T15:36:59.765Z' }) builtAt!: string;
  @ApiProperty({ type: ActiveFilterStateDto }) activeFilters!: ActiveFilterStateDto;
  @ApiProperty({ example: 1_300, description: 'Кандидатов на входе фильтра' })
  before!: number;
  @ApiProperty({ example: 602, description: 'Кандидатов после него — оно же status.passed' })
  after!: number;
  @ApiProperty({ type: FunnelReportDto }) funnel!: FunnelReportDto;
}

export class AlphaApplyResponseDto {
  @ApiProperty({ example: '2026-08-25' }) universeVersion!: string;
  @ApiProperty({ example: '2026-08-25T15:36:59.765Z' }) builtAt!: string;
  @ApiProperty({ type: ActiveFilterStateDto }) activeFilters!: ActiveFilterStateDto;
  @ApiProperty({
    example: 602,
    description: 'Вход альфы: survivors screen, а при выключенном screen — весь снимок',
  })
  before!: number;
  @ApiProperty({ example: 214 }) after!: number;
  @ApiProperty({ example: 388 }) dropped!: number;
  @ApiProperty({ type: AlphaSectorSummaryDto, isArray: true })
  sectors!: AlphaSectorSummaryDto[];
  @ApiProperty({
    type: AlphaDataGapDto,
    isArray: true,
    description: 'Первые 50 строк очереди; полное число — в dataGapsTotal',
  })
  dataGaps!: AlphaDataGapDto[];
  @ApiProperty({ example: 331 }) dataGapsTotal!: number;
  @ApiProperty({ type: FunnelReportDto }) funnel!: FunnelReportDto;
  @ApiProperty({ type: [String] }) warnings!: string[];
  @ApiProperty({ type: UniverseStatusDto, description: 'Уже пересчитанный статус' })
  status!: UniverseStatusDto;
}

export class CandidateRefDto {
  @ApiProperty({ example: 'aave' }) coingeckoId!: string;
  @ApiProperty({ example: 'AAVE' }) ticker!: string;
}

export class TierChangeDto extends CandidateRefDto {
  @ApiProperty({ enum: ['yield', 'economics', 'pool', 'rejected'] }) left!: string;
  @ApiProperty({ enum: ['yield', 'economics', 'pool', 'rejected'] }) right!: string;
}

export class CompareSideDto {
  @ApiProperty({ type: AnalysisProfileDto }) profile!: AnalysisProfileDto;
  @ApiProperty({ type: FunnelReportDto }) funnel!: FunnelReportDto;
}

export class UniverseCompareResponseDto {
  @ApiProperty({ example: '2026-08-24' }) universeVersion!: string;
  @ApiProperty({ example: '2026-08-24T17:48:30.000Z' }) builtAt!: string;
  @ApiProperty({ type: CompareSideDto }) left!: CompareSideDto;
  @ApiProperty({ type: CompareSideDto }) right!: CompareSideDto;
  @ApiProperty({ type: CandidateRefDto, isArray: true }) both!: CandidateRefDto[];
  @ApiProperty({ type: CandidateRefDto, isArray: true }) onlyLeft!: CandidateRefDto[];
  @ApiProperty({ type: CandidateRefDto, isArray: true }) onlyRight!: CandidateRefDto[];
  @ApiProperty({ type: TierChangeDto, isArray: true }) tierChanges!: TierChangeDto[];
}
