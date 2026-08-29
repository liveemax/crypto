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

/** Три точных ключа, сумма которых обязана равняться 1. Свободный Record сюда не годится. */
export type EvaluationWeights = Record<EvaluationComponentName, number>;

/** Единственный кодовый компонент, отложенный до появления корпуса и benchmark. */
export type NotEvaluatedComponentId = 'mechanism';

/**
 * Явная замена вместо score:0 у компонента, которого нет. Карточка называет,
 * что не посчитано, почему, и какие измеренные факты заменяют догадку.
 */
export interface NotEvaluatedComponent {
  id: NotEvaluatedComponentId;
  why: string;
  whatWeMeasureInstead: string[];
}

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
  /** Компоненты композита, которых у этой карточки нет и не будет score:0. */
  notEvaluated: NotEvaluatedComponent[];
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
  /** Только факты tokenomics по токенам; состав активной выборки сюда не входит. */
  perToken: string;
  /** Состав групп, конфигурация и версии обеих сравнительных формул. */
  comparative: string;
}

export interface EvaluationFormulaVersions {
  businessScale: string;
  valuation: string;
}

export interface EvaluationRun {
  runId: string;
  createdAt: string;
  universeVersion: string;
  builtAt: string;
  activeFilters: ActiveFilterState;
  evaluationProfileId: string;
  formulaVersions: EvaluationFormulaVersions;
  inputHashes: EvaluationInputHashes;
  inputCount: number;
  evaluatedCount: number;
  dataGapCount: number;
  warnings: string[];
  summaries: Record<EvaluationComponentName, EvaluationSummary>;
  /** Один и тот же список у каждого прогона: LLM не вызывается ни для одной карточки. */
  notEvaluated: NotEvaluatedComponent[];
  candidates: CandidateEvaluation[];
}

/**
 * Происхождение и страница объявлены один раз в core/envelope.types: две копии
 * одной формы расходятся ровно тогда, когда в конверт добавляется поле.
 */
export type EvaluationContext = ResponseContext;
export type { PaginationInfo };

export interface EvaluationComponentReuse {
  status: 'reused' | 'recomputed' | 'partial';
  reused: number;
  recomputed: number;
}

export interface EvaluationReuse {
  components: Record<EvaluationComponentName, EvaluationComponentReuse>;
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
  notEvaluated: NotEvaluatedComponent[];
}

export interface EvaluationListResponse {
  context: EvaluationContext;
  runId: string;
  createdAt: string;
  evaluationProfileId: string;
  formulaVersions: EvaluationFormulaVersions;
  summaries: Record<EvaluationComponentName, EvaluationSummary>;
  notEvaluated: NotEvaluatedComponent[];
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
