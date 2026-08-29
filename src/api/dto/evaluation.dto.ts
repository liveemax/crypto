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

export class EvaluationListResponseDto {
  @ApiProperty({ type: EvaluationContextDto }) context!: EvaluationContextDto;
  @ApiProperty({ example: 'eval_2026-08-28T09-12-00-000Z_deep-value' }) runId!: string;
  @ApiProperty({ example: '2026-08-28T09:12:00.000Z' }) createdAt!: string;
  @ApiProperty({ example: 'deep-value' }) evaluationProfileId!: string;
  @ApiProperty({ type: EvaluationSummaryDto, additionalProperties: true })
  summaries!: Record<string, EvaluationSummaryDto>;
  @ApiProperty({ type: PaginationDto }) pagination!: PaginationDto;
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: 'view=summary — баллы и качество; view=full — блоки целиком',
  })
  items!: unknown[];
}

export class EvaluationReuseDto {
  @ApiProperty({ example: true }) perToken!: boolean;
  @ApiProperty({ example: false }) comparative!: boolean;
  @ApiProperty({ example: 331 }) reusedTokens!: number;
  @ApiProperty({ example: 0 }) recomputedTokens!: number;
  @ApiProperty({ example: 331 }) recomputedSectorPosition!: number;
  @ApiProperty({
    example: 'Числа те же, состав группы сравнения изменился: пересчитан только sectorPosition.',
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