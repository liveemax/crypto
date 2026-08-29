import type { Metric } from '../types';
import type { PaginationInfo, ResponseContext } from '../envelope.types';
import type { ActiveFilterState } from '../universe/filter-state.types';
import type { Tier } from '../universe/universe.types';

/** Три компонента одной кодовой оценки. Это не агенты: ни сети, ни модели здесь нет. */
export type EvaluationComponentName = 'valuation' | 'tokenomics' | 'sectorPosition';

export const EVALUATION_COMPONENTS: EvaluationComponentName[] = [
  'valuation',
  'tokenomics',
  'sectorPosition',
];

/**
 * Проверка порога и тот, кто её уже применил. Без appliedBy поле бессмысленно:
 * при включённом deep-value проверки тривиально пройдены, потому что screen
 * применил те же пороги, а при выключенном то же поле работает скрытым фильтром.
 */
export interface EvaluationCheck {
  id: string;
  passed: boolean;
  appliedBy: 'screen' | 'evaluation';
  reason: string | null;
}

export interface EvaluationBlock {
  component: EvaluationComponentName;
  title: string;
  verdict: Record<string, unknown>;
  score: number | null;
  scoreRaw?: number;
  metrics: Record<string, Metric>;
  dataQuality: number;
  missing: string[];
  notes: string;
  validator?: { dropped: string[]; stale: string[] };
  error?: string;
}

export interface CandidateEvaluation {
  coingeckoId: string;
  ticker: string;
  name: string;
  comparisonGroup: string | null;
  /** Тир данных: yield/economics/pool. НЕ тир рейтинга. */
  dataTier: Tier;
  valuation: EvaluationBlock;
  tokenomics: EvaluationBlock;
  sectorPosition: EvaluationBlock;
}

export interface EvaluationSummary {
  component: EvaluationComponentName;
  /** Строк с баллом; остальные — честный отказ, а не ноль. */
  scored: number;
  skipped: number;
  hardFilterFail: number;
  avgScore: number | null;
  avgDataQuality: number;
}

export interface EvaluationInputHashes {
  /** universeVersion, builtAt, числа всей вселенной и профиль оценки. */
  perToken: string;
  /** perToken плюс состав группы сравнения и конфигурация ранжирования. */
  comparative: string;
}

export interface EvaluationRun {
  runId: string;
  createdAt: string;
  universeVersion: string;
  builtAt: string;
  activeFilters: ActiveFilterState;
  evaluationProfileId: string;
  inputHashes: EvaluationInputHashes;
  inputCount: number;
  evaluatedCount: number;
  dataGapCount: number;
  warnings: string[];
  summaries: Record<EvaluationComponentName, EvaluationSummary>;
  candidates: CandidateEvaluation[];
}

/**
 * Происхождение и страница объявлены один раз в core/envelope.types: две копии
 * одной формы расходятся ровно тогда, когда в конверт добавляется поле.
 */
export type EvaluationContext = ResponseContext;
export type { PaginationInfo };

export interface EvaluationReuse {
  perToken: boolean;
  comparative: boolean;
  reusedTokens: number;
  recomputedTokens: number;
  recomputedSectorPosition: number;
  note: string;
}

export interface EvaluationRunRequest {
  profileId?: string;
  refresh?: boolean;
}

export interface EvaluationListQuery {
  offset?: number;
  limit?: number;
  view?: 'summary' | 'full';
}

/** Строка summary: тяжёлые ветви по умолчанию в браузер не едут. */
export interface EvaluationSummaryRow {
  coingeckoId: string;
  ticker: string;
  name: string;
  comparisonGroup: string | null;
  dataTier: Tier;
  scores: Record<EvaluationComponentName, number | null>;
  dataQuality: Record<EvaluationComponentName, number>;
  hardFilterFail: boolean;
  missing: string[];
}

export interface EvaluationListResponse {
  context: EvaluationContext;
  runId: string;
  createdAt: string;
  evaluationProfileId: string;
  summaries: Record<EvaluationComponentName, EvaluationSummary>;
  pagination: PaginationInfo;
  items: (CandidateEvaluation | EvaluationSummaryRow)[];
}

export interface EvaluationRunResponse extends EvaluationListResponse {
  inputCount: number;
  evaluatedCount: number;
  dataGapCount: number;
  inputHashes: EvaluationInputHashes;
  reuse: EvaluationReuse;
  warnings: string[];
}

export interface EvaluationTokenResponse {
  status: 'evaluated' | 'not_in_selection';
  context: EvaluationContext | null;
  runId: string | null;
  reason: string | null;
  nextAction: { method: string; path: string; body: Record<string, unknown> } | null;
  evaluation: CandidateEvaluation | null;
}