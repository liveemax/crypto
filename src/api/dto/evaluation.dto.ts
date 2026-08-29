import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class EvaluationRunDto {
  @ApiPropertyOptional({
    example: 'deep-value',
    description: 'Профиль шкал и порогов оценки. Отбор он не меняет и фильтры не включает',
  })
  @IsOptional()
  @IsString()
  profileId?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Пересчитать, игнорируя совместимый прогон',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === null || value === '' ? undefined : value === true || value === 'true' || value === '1',
  )
  @IsBoolean()
  refresh?: boolean;
}

export class EvaluationQueryDto {
  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ example: 50, description: 'По умолчанию 50, максимум 200' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({
    enum: ['summary', 'full'],
    example: 'summary',
    description: 'full отдаёт метрики и перцентили: мегабайты JSON вешают вкладку, а не сервер',
  })
  @IsOptional()
  @IsIn(['summary', 'full'])
  view?: 'summary' | 'full';
}

export class MetricDto {
  @ApiProperty({ nullable: true, example: 107_000_000 }) value!: number | string | null;
  @ApiProperty({ example: 'USD' }) unit!: string;
  @ApiProperty({ nullable: true, example: 'https://defillama.com/protocol/aave-v3' })
  sourceUrl!: string | null;
  @ApiProperty({ nullable: true, example: '2026-08-27T06:00:00.000Z' })
  asOf!: string | null;
  @ApiPropertyOptional({ enum: ['no_source', 'no_as_of'] })
  droppedReason?: string;
  @ApiPropertyOptional({ example: 61 }) staleDays?: number;
}

export class EvaluationCheckDto {
  @ApiProperty({ example: 'pRevSane' }) id!: string;
  @ApiProperty({ example: false }) passed!: boolean;
  @ApiProperty({
    enum: ['screen', 'evaluation'],
    example: 'evaluation',
    description: 'Кто уже применил порог: screen отсеял по нему, evaluation только измерила',
  })
  appliedBy!: string;
  @ApiProperty({ nullable: true, example: 'P/Rev 84 при пороге 60' }) reason!: string | null;
}

export class EvaluationBlockDto {
  @ApiProperty({ enum: ['valuation', 'tokenomics', 'sectorPosition'] })
  component!: string;
  @ApiProperty({ example: 'Секторная оценка цены относительно бизнеса' }) title!: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) verdict!: Record<string, unknown>;
  @ApiProperty({ nullable: true, example: 69.2, description: 'null — данных не хватило, это не ноль' })
  score!: number | null;
  @ApiPropertyOptional({ example: 75, description: 'Балл до множителя качества данных' })
  scoreRaw?: number;
  @ApiProperty({ type: MetricDto, additionalProperties: true }) metrics!: Record<string, MetricDto>;
  @ApiProperty({ example: 0.875 }) dataQuality!: number;
  @ApiProperty({ type: [String], example: ['unlock12mPct'] }) missing!: string[];
  @ApiProperty({ example: 'Все пороги профиля пройдены.' }) notes!: string;
}

export class NotEvaluatedComponentDto {
  @ApiProperty({ example: 'mechanism', description: 'Компонент композита, у которого нет score' })
  id!: string;
  @ApiProperty({
    example: 'Механизм возврата ценности требует чтения документации протокола',
  })
  why!: string;
  @ApiProperty({
    type: [String],
    example: ['holdersRevenue12mUsd', 'payoutRatioPct', 'holderYieldPct'],
    description: 'Измеренные факты рядом, вместо догадки о неизмеренном компоненте',
  })
  whatWeMeasureInstead!: string[];
}

export class RiskFlagDto {
  @ApiProperty({
    enum: ['high_turnover', 'illiquid', 'negative_after_incentives'],
    example: 'high_turnover',
  })
  id!: string;
  @ApiProperty({
    example: 'Оборот 63.4% от капитализации за сутки: экстремально высокая торговая ' +
      'активность, возможна манипуляция ценой',
  })
  label!: string;
  @ApiProperty({ example: 63.4, description: 'Измеренное значение, из которого посчитан флаг' })
  value!: number;
  @ApiProperty({ example: 10 }) penalty!: number;
  @ApiProperty({ type: MetricDto, description: 'Provenance входной метрики флага' })
  metric!: MetricDto;
}

export class CandidateEvaluationDto {
  @ApiProperty({ example: 'aave' }) coingeckoId!: string;
  @ApiProperty({ example: 'AAVE' }) ticker!: string;
  @ApiProperty({ example: 'Aave' }) name!: string;
  @ApiProperty({ nullable: true, example: 'lending' }) comparisonGroup!: string | null;
  @ApiProperty({ enum: ['yield', 'economics', 'pool', 'rejected'], example: 'yield' })
  dataTier!: string;
  @ApiProperty({ type: EvaluationBlockDto }) valuation!: EvaluationBlockDto;
  @ApiProperty({ type: EvaluationBlockDto }) tokenomics!: EvaluationBlockDto;
  @ApiProperty({ type: EvaluationBlockDto }) sectorPosition!: EvaluationBlockDto;
  @ApiProperty({
    type: NotEvaluatedComponentDto,
    isArray: true,
    description: 'Компоненты композита без score: не ноль, а явная причина',
  })
  notEvaluated!: NotEvaluatedComponentDto[];
  @ApiProperty({
    type: RiskFlagDto,
    isArray: true,
    description: 'Сработавшие риск-флаги: не четвёртый компонент, score не меняют',
  })
  riskFlags!: RiskFlagDto[];
  @ApiProperty({ example: 10, description: 'Сумма штрафов флагов, не более 20' })
  flagPenalty!: number;
  @ApiProperty({
    type: [String],
    example: ['incentives12mUsd'],
    description: 'Метрик не хватило для риск-флагов: неизвестное не стало нулём',
  })
  riskMissing!: string[];
}

export class EvaluationContextDto {
  @ApiProperty({ example: '2026-08-26' }) universeVersion!: string;
  @ApiProperty({ example: '2026-08-26T06:00:00.000Z' }) builtAt!: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  activeFilters!: Record<string, unknown>;
  @ApiProperty({ example: '2026-08-28T09:12:00.000Z' }) asOf!: string;
}

export class PaginationDto {
  @ApiProperty({ example: 0 }) offset!: number;
  @ApiProperty({ example: 50 }) limit!: number;
  @ApiProperty({ example: 331 }) total!: number;
  @ApiProperty({ example: true }) hasMore!: boolean;
}

export class EvaluationSummaryDto {
  @ApiProperty({ enum: ['valuation', 'tokenomics', 'sectorPosition'] }) component!: string;
  @ApiProperty({ example: 247 }) scored!: number;
  @ApiProperty({ example: 84 }) skipped!: number;
  @ApiProperty({ example: 6 }) hardFilterFail!: number;
  @ApiProperty({ nullable: true, example: 58.3 }) avgScore!: number | null;
  @ApiProperty({ example: 0.812 }) avgDataQuality!: number;
}

export class EvaluationFormulaVersionsDto {
  @ApiProperty({ example: 'business-scale-v1' }) businessScale!: string;
  @ApiProperty({ example: 'sector-valuation-v1' }) valuation!: string;
}

export class EvaluationSummaryRowDto {
  @ApiProperty({ example: 'aave' }) coingeckoId!: string;
  @ApiProperty({ example: 'AAVE' }) ticker!: string;
  @ApiProperty({ example: 'Aave' }) name!: string;
  @ApiProperty({ nullable: true, example: 'lending' }) comparisonGroup!: string | null;
  @ApiProperty({ enum: ['yield', 'economics', 'pool', 'rejected'], example: 'yield' })
  dataTier!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number', nullable: true } })
  scores!: Record<string, number | null>;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  dataQuality!: Record<string, number>;
  @ApiProperty({ example: false }) hardFilterFail!: boolean;
  @ApiProperty({ type: [String], example: ['unlock12mPct'] }) missing!: string[];
  @ApiProperty({ type: NotEvaluatedComponentDto, isArray: true })
  notEvaluated!: NotEvaluatedComponentDto[];
}

export class EvaluationListResponseDto {
  @ApiProperty({ type: EvaluationContextDto }) context!: EvaluationContextDto;
  @ApiProperty({ example: 'eval_2026-08-28T09-12-00-000Z_deep-value' }) runId!: string;
  @ApiProperty({ example: '2026-08-28T09:12:00.000Z' }) createdAt!: string;
  @ApiProperty({ example: 'deep-value' }) evaluationProfileId!: string;
  @ApiProperty({ type: EvaluationFormulaVersionsDto })
  formulaVersions!: EvaluationFormulaVersionsDto;
  @ApiProperty({ type: EvaluationSummaryDto, additionalProperties: true })
  summaries!: Record<string, EvaluationSummaryDto>;
  @ApiProperty({
    type: NotEvaluatedComponentDto,
    isArray: true,
    description: 'Один и тот же список у каждого прогона: продукт полностью кодовый',
  })
  notEvaluated!: NotEvaluatedComponentDto[];
  @ApiProperty({ type: PaginationDto }) pagination!: PaginationDto;
  @ApiProperty({
    type: EvaluationSummaryRowDto,
    isArray: true,
    description: 'view=summary — баллы и качество; view=full — блоки целиком',
  })
  items!: unknown[];
}

export class EvaluationComponentReuseDto {
  @ApiProperty({ enum: ['reused', 'recomputed', 'partial'], example: 'reused' })
  status!: string;
  @ApiProperty({ example: 331 }) reused!: number;
  @ApiProperty({ example: 0 }) recomputed!: number;
}

export class EvaluationReuseDto {
  @ApiProperty({ type: EvaluationComponentReuseDto, additionalProperties: true })
  components!: Record<string, EvaluationComponentReuseDto>;
  @ApiProperty({
    example: 'Состав группы изменился: tokenomics переиспользован, comparative-компоненты пересчитаны.',
  })
  note!: string;
}

export class EvaluationRunResponseDto extends EvaluationListResponseDto {
  @ApiProperty({ example: 1_300 }) inputCount!: number;
  @ApiProperty({ example: 331 }) evaluatedCount!: number;
  @ApiProperty({ example: 84, description: 'Строк, где хотя бы один компонент без балла' })
  dataGapCount!: number;
  @ApiProperty({ type: 'object', additionalProperties: true })
  inputHashes!: Record<string, string>;
  @ApiProperty({ type: EvaluationReuseDto }) reuse!: EvaluationReuseDto;
  @ApiProperty({ type: [String] }) warnings!: string[];
}

export class EvaluationTokenResponseDto {
  @ApiProperty({ enum: ['evaluated', 'not_in_selection'], example: 'evaluated' })
  status!: string;
  @ApiProperty({ type: EvaluationContextDto, nullable: true })
  context!: EvaluationContextDto | null;
  @ApiProperty({ nullable: true }) runId!: string | null;
  @ApiProperty({ nullable: true, example: 'Отсеян на стадии turnover: оборот 0.0001%' })
  reason!: string | null;
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true })
  nextAction!: Record<string, unknown> | null;
  @ApiProperty({ type: CandidateEvaluationDto, nullable: true })
  evaluation!: CandidateEvaluationDto | null;
}
