import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto, ResponseContextDto } from '../../core/envelope.dto';
import {
  CandidateEvaluationDto,
  EvaluationQueryDto,
  NotEvaluatedComponentDto,
} from './evaluation.dto';

export class RankingRunDto {
  @ApiPropertyOptional({
    example: 'deep-value',
    description:
      'Профиль весов и тиров ranking. Тот же профиль обязан пойти в evaluation: ' +
      'ranking пересчитывает её сам, если сохранённая несовместима',
  })
  @IsOptional()
  @IsString()
  profileId?: string;
}

/** Пагинация и view=summary|full те же, что у остальных списков: одна форма запроса. */
export class RankingQueryDto extends EvaluationQueryDto {}

export class RankingFormulaVersionsDto {
  @ApiProperty({ example: 'business-scale-v1' }) businessScale!: string;
  @ApiProperty({ example: 'sector-valuation-v1' }) valuation!: string;
  @ApiProperty({ example: 'ranking-composite-v1' }) ranking!: string;
}

export class HardFilterReasonDto {
  @ApiProperty({
    enum: ['valuation_failed', 'tokenomics_hard_filter'],
    example: 'tokenomics_hard_filter',
  })
  id!: string;
  @ApiProperty({
    example: 'Подтверждённый отрицательный NHY: разводнение съедает весь доход держателя.',
  })
  reason!: string;
}

export class RankingCompositeDto {
  @ApiProperty({ nullable: true, example: 71.4, description: 'Взвешенное среднее до вычета flagPenalty' })
  compositeBase!: number | null;
  @ApiProperty({ nullable: true, example: 61.4, description: 'После вычета flagPenalty; именно он решает тир' })
  composite!: number | null;
  @ApiProperty({ type: [String], example: ['valuation', 'tokenomics'] })
  componentsUsed!: string[];
  @ApiProperty({ example: 0.7 }) weightSum!: number;
  @ApiProperty({ nullable: true, example: null, description: 'null — гейт композита пройден' })
  compositeReason!: string | null;
  @ApiProperty({ example: 0.82, description: 'Взвешенное качество данных участвовавших компонентов' })
  dataQuality!: number;
}

export class RankingRiskFlagSummaryDto {
  @ApiProperty({
    enum: ['high_turnover', 'illiquid', 'negative_after_incentives'],
    example: 'high_turnover',
  })
  id!: string;
  @ApiProperty({
    example: 'Оборот 63.4% от капитализации за сутки: экстремально высокая торговая активность',
  })
  label!: string;
  @ApiProperty({ example: 10 }) penalty!: number;
}

export class RankingSummaryRowDto {
  @ApiProperty({ example: 'aave' }) coingeckoId!: string;
  @ApiProperty({ example: 'AAVE' }) ticker!: string;
  @ApiProperty({ example: 'Aave' }) name!: string;
  @ApiProperty({ nullable: true, example: 'lending' }) comparisonGroup!: string | null;
  @ApiProperty({ enum: ['yield', 'economics', 'pool', 'rejected'], example: 'yield' })
  dataTier!: string;
  @ApiProperty({ enum: ['A', 'B', 'C', 'watchlist'], example: 'B' }) rankTier!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number', nullable: true },
    example: { valuation: 61.2, tokenomics: 70.5, sectorPosition: null },
  })
  scores!: Record<string, number | null>;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { valuation: 0.9, tokenomics: 1, sectorPosition: 0.8 },
  })
  dataQuality!: Record<string, number>;
  @ApiProperty({ type: RankingCompositeDto }) composite!: RankingCompositeDto;
  @ApiProperty({ type: HardFilterReasonDto, isArray: true }) hardFilters!: HardFilterReasonDto[];
  @ApiProperty({ type: [String], example: ['unlock12mPct'] }) missing!: string[];
  @ApiProperty({ type: RankingRiskFlagSummaryDto, isArray: true }) riskFlags!: RankingRiskFlagSummaryDto[];
  @ApiProperty({ example: 10, description: 'Сумма штрафов флагов, не более 20' }) flagPenalty!: number;
  @ApiProperty({ type: NotEvaluatedComponentDto, isArray: true }) notEvaluated!: NotEvaluatedComponentDto[];
}

export class RankedCandidateDto {
  @ApiProperty({ type: CandidateEvaluationDto, description: 'Полная evaluation-карточка: metrics, percentiles, peers и provenance едут внутри неё' })
  evaluation!: CandidateEvaluationDto;
  @ApiProperty({ enum: ['A', 'B', 'C', 'watchlist'], example: 'B' }) rankTier!: string;
  @ApiProperty({ nullable: true, example: 71.4 }) compositeBase!: number | null;
  @ApiProperty({ nullable: true, example: 61.4 }) composite!: number | null;
  @ApiProperty({ type: [String], example: ['valuation', 'tokenomics'] })
  componentsUsed!: string[];
  @ApiProperty({ example: 0.7 }) weightSum!: number;
  @ApiProperty({ nullable: true, example: null }) compositeReason!: string | null;
  @ApiProperty({ example: 0.82 }) dataQuality!: number;
  @ApiProperty({ type: HardFilterReasonDto, isArray: true }) hardFilters!: HardFilterReasonDto[];
  @ApiProperty({
    type: [String],
    example: ['Не хватает данных: unlock12mPct.'],
    description: 'Что изменило бы тир или сам факт наличия композита',
  })
  whatWouldChangeThis!: string[];
}

export class RankingContextDto extends ResponseContextDto {}

export class RankingListResponseDto {
  @ApiProperty({ type: RankingContextDto }) context!: RankingContextDto;
  @ApiProperty({ example: 'rank_2026-08-28T09-12-00-000Z_deep-value' }) runId!: string;
  @ApiProperty({ example: '2026-08-28T09:12:00.000Z' }) createdAt!: string;
  @ApiProperty({ example: 'deep-value' }) rankingProfileId!: string;
  @ApiProperty({ type: RankingFormulaVersionsDto }) formulaVersions!: RankingFormulaVersionsDto;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { A: 12, B: 40, C: 279, watchlist: 21 },
    description: 'Watchlist не прячется: считается отдельным ключом, а не исключается из totals',
  })
  tiers!: Record<string, number>;
  @ApiProperty({ type: NotEvaluatedComponentDto, isArray: true }) notEvaluated!: NotEvaluatedComponentDto[];
  @ApiProperty({ type: PaginationDto }) pagination!: PaginationDto;
  @ApiProperty({
    type: RankingSummaryRowDto,
    isArray: true,
    description: 'view=summary — баллы и тир; view=full — полная evaluation-карточка каждого кандидата',
  })
  items!: unknown[];
}

export class RankingRunResponseDto extends RankingListResponseDto {
  @ApiProperty({ example: 'eval_2026-08-28T09-12-00-000Z_deep-value' }) evaluationRunId!: string;
  @ApiProperty({
    example: false,
    description: 'true — сохранённая evaluation была несовместима и пересчитана этим же запросом',
  })
  evaluationRecomputed!: boolean;
  @ApiProperty({ example: 352 }) candidateCount!: number;
  @ApiProperty({ type: 'object', additionalProperties: true }) inputHashes!: Record<string, string>;
}
