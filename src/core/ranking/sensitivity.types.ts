import type { PaginationInfo, ResponseContext } from '../envelope.types';
import type { EvaluationWeights } from '../evaluation/evaluation.types';
import type { RankTier } from './ranking.types';

export interface SensitivityRunRequest {
  runId: string;
  offset?: number;
  limit?: number;
}

/**
 * Один из 25 нормированных наборов весов. Множитель sectorPosition всегда 1.00
 * (в сетке не участвует), tokenomics и valuation берутся из сетки множителей.
 */
export interface SensitivityScenario {
  tokenomicsMultiplier: number;
  valuationMultiplier: number;
  weights: EvaluationWeights;
}

/**
 * Реакция одного кандидата на все 25 сценариев. dataQuality, hardFilters и
 * flagPenalty здесь не переменные: они берутся из baseline ranking run и не
 * меняются с весами — sensitivity изолирует именно эффект весов.
 */
export interface SensitivityCandidateResult {
  coingeckoId: string;
  ticker: string;
  name: string;
  baselineTier: RankTier;
  baselineComposite: number | null;
  /** null — во всех 25 сценариях composite остаётся null (гейт не пройден ни разу). */
  minComposite: number | null;
  maxComposite: number | null;
  /** Из 25 сценариев — сколько дали тир, отличный от baselineTier. */
  tierChanges: number;
  /** Уникальные тиры, встреченные хотя бы в одном сценарии, в порядке A/B/C/watchlist. */
  tiersReached: RankTier[];
}

export type SensitivityInterpretation = 'stable' | 'sensitive' | 'insufficient_data';

export interface SensitivitySummary {
  scenarioCount: number;
  /** Сколько кандидатов имеют baselineComposite !== null — знаменатель интерпретации. */
  candidatesWithComposite: number;
  /** Из них — сколько сменили тир хотя бы в одном из 25 сценариев. */
  candidatesTierChanged: number;
  tierChangedSharePct: number;
  interpretation: SensitivityInterpretation;
  /**
   * [baselineTier][тир сценария] = число наблюдений кандидат×сценарий. Watchlist
   * не покидает свою строку ни в одной ячейке: хард-фильтр весами не лечится.
   */
  transitionMatrix: Record<RankTier, Record<RankTier, number>>;
}

export interface SensitivityResult {
  context: ResponseContext;
  runId: string;
  rankingProfileId: string;
  formulaVersion: string;
  baselineWeights: EvaluationWeights;
  scenarios: SensitivityScenario[];
  summary: SensitivitySummary;
  pagination: PaginationInfo;
  items: SensitivityCandidateResult[];
  /** Дословный дисклеймер продукта, обязателен в каждом ranking-ответе. */
  disclaimer: string;
}
