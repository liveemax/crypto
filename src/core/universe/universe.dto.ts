import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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
  @ApiProperty({ nullable: true, example: 'lending' }) sector!: string | null;
  @ApiProperty({ enum: ['gecko_id', 'chain', 'override', 'none'] }) matchedBy!: string;
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
  @ApiProperty({ nullable: true, example: 'turnover' }) rejectedAt!: string | null;
  @ApiProperty({ nullable: true }) rejectReason!: string | null;
}

export class FunnelStageDto {
  @ApiProperty({ example: 'turnover' }) stage!: string;
  @ApiProperty({ example: 'Оборот не ниже 0.1% капитализации за сутки' }) label!: string;
  @ApiProperty({ example: 1_150 }) incoming!: number;
  @ApiProperty({ example: 180 }) dropped!: number;
  @ApiProperty({ example: 970 }) kept!: number;
}

export class FunnelTiersDto {
  @ApiProperty({ example: 60, description: 'Выручка доходит до держателей токена' })
  yield!: number;
  @ApiProperty({ example: 90, description: 'Выручка есть, до держателей не доходит' })
  economics!: number;
  @ApiProperty({ example: 550, description: 'Шлак-фильтр пройден, финансовых данных нет' })
  pool!: number;
  @ApiProperty({ example: 600 }) rejected!: number;
}

export class FunnelReportDto {
  @ApiProperty({ example: 1_300 }) total!: number;
  @ApiProperty({ type: FunnelStageDto, isArray: true }) stages!: FunnelStageDto[];
  @ApiProperty({ example: 700 }) passed!: number;
  @ApiProperty({ type: FunnelTiersDto }) tiers!: FunnelTiersDto;
}

export class UniverseProgressDto {
  @ApiProperty({
    enum: [
      'idle', 'markets', 'categories', 'protocols', 'chains',
      'fees', 'join', 'filter', 'save', 'done', 'failed',
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
  @ApiProperty({ nullable: true, example: 'HTTP 429: Too Many Requests' })
  lastError!: string | null;
  @ApiProperty({ nullable: true }) startedAt!: string | null;
  @ApiProperty({ example: 48 }) elapsedSec!: number;
  @ApiProperty({ nullable: true, example: 24 }) etaSec!: number | null;
}

export class UniverseStatusDto {
  @ApiProperty({ enum: ['idle', 'running', 'error'] }) state!: string;
  @ApiProperty({ type: UniverseProgressDto }) progress!: UniverseProgressDto;
  @ApiProperty({ nullable: true }) error!: string | null;
  @ApiProperty({ nullable: true, example: '2026-08-24' }) version!: string | null;
  @ApiProperty({ nullable: true, example: 3 }) ageDays!: number | null;
  @ApiProperty({ nullable: true, example: 1_300 }) total!: number | null;
  @ApiProperty({ nullable: true, example: 700 }) passed!: number | null;
  @ApiProperty({ type: FunnelTiersDto, nullable: true }) tiers!: FunnelTiersDto | null;
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
