import type { ActiveFilterState } from '../universe/filter-state.types';
import type { DataTier } from '../universe/universe.types';
import type { PaginationInfo, ResponseContext } from '../envelope.types';
import type {
  CandidateEvaluation,
  EvaluationComponentName,
  EvaluationInputHashes,
  NotEvaluatedComponent,
  RiskFlagId,
} from '../evaluation/evaluation.types';

/**
 * Тир рейтинга. НЕ тир данных (см. DataTier в core/universe): watchlist — это
 * хард-фильтр, а не низкое качество данных.
 */
export type RankTier = 'A' | 'B' | 'C' | 'watchlist';

/** Ровно два хард-фильтра шага 15.1. Риск-флаг сюда не входит. */
export type HardFilterId = 'valuation_failed' | 'tokenomics_hard_filter';

export interface HardFilterReason {
  id: HardFilterId;
  reason: string;
}

export interface RankingFormulaVersions {
  businessScale: string;
  valuation: string;
  ranking: string;
}

/**
 * Карточка кандидата в рейтинге. Полная evaluation-карточка едет внутри
 * целиком: метрики, provenance, notEvaluated и riskFlags уже есть у неё и не
 * дублируются здесь под другими именами.
 */
export interface RankedCandidate {
  evaluation: CandidateEvaluation;
  rankTier: RankTier;
  /** Взвешенное среднее компонентов до вычета flagPenalty. */
  compositeBase: number | null;
  /** Итог после вычета flagPenalty и зажима в 0..100. Именно он решает тир. */
  composite: number | null;
  componentsUsed: EvaluationComponentName[];
  weightSum: number;
  /** Причина null-композита; null — композит посчитан. */
  compositeReason: string | null;
  /** Взвешенное качество данных участвовавших компонентов: гейт тира A и C. */
  dataQuality: number;
  hardFilters: HardFilterReason[];
  /** Что изменило бы тир или сам факт наличия композита. */
  whatWouldChangeThis: string[];
}

export interface RankingRunRequest {
  profileId?: string;
}

export interface RankingRun {
  runId: string;
  createdAt: string;
  universeVersion: string;
  builtAt: string;
  activeFilters: ActiveFilterState;
  rankingProfileId: string;
  formulaVersions: RankingFormulaVersions;
  inputHashes: EvaluationInputHashes;
  evaluationRunId: string;
  /** true — evaluation была пересчитана заново под этот ranking run. */
  evaluationRecomputed: boolean;
  candidateCount: number;
  tiers: Record<RankTier, number>;
  notEvaluated: NotEvaluatedComponent[];
  candidates: RankedCandidate[];
}

export interface RankingListQuery {
  offset?: number;
  limit?: number;
  view?: 'summary' | 'full';
}

/** Композит и его метаданные одним объектом: то же взвешенное среднее, что решает тир. */
export interface RankingCompositeMeta {
  compositeBase: number | null;
  composite: number | null;
  componentsUsed: EvaluationComponentName[];
  weightSum: number;
  compositeReason: string | null;
  dataQuality: number;
}

/** Короткая версия риск-флага для summary: provenance метрики едет только в full. */
export interface RankingRiskFlagSummary {
  id: RiskFlagId;
  label: string;
  penalty: number;
}

/** Строка summary: тяжёлые metrics/percentiles/peers/provenance остаются только в full. */
export interface RankingSummaryRow {
  coingeckoId: string;
  ticker: string;
  name: string;
  comparisonGroup: string | null;
  dataTier: DataTier;
  rankTier: RankTier;
  scores: Record<EvaluationComponentName, number | null>;
  dataQuality: Record<EvaluationComponentName, number>;
  composite: RankingCompositeMeta;
  hardFilters: HardFilterReason[];
  missing: string[];
  riskFlags: RankingRiskFlagSummary[];
  flagPenalty: number;
  notEvaluated: NotEvaluatedComponent[];
}

export interface RankingListResponse {
  context: ResponseContext;
  runId: string;
  createdAt: string;
  rankingProfileId: string;
  formulaVersions: RankingFormulaVersions;
  tiers: Record<RankTier, number>;
  notEvaluated: NotEvaluatedComponent[];
  pagination: PaginationInfo;
  items: (RankedCandidate | RankingSummaryRow)[];
  /** Дословный дисклеймер продукта, обязателен в каждом ranking-ответе. */
  disclaimer: string;
}

export interface RankingRunResponse extends RankingListResponse {
  evaluationRunId: string;
  evaluationRecomputed: boolean;
  candidateCount: number;
  inputHashes: EvaluationInputHashes;
}
