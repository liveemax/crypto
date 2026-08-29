import type { NextAction } from '../errors';
import type { JobSnapshot } from '../jobs/job.types';
import type { ActiveFilterState } from '../universe/filter-state.types';
import type { Tier } from '../universe/universe.types';

export interface UniverseFreshness {
  version: string | null;
  builtAt: string | null;
  ageDays: number | null;
  total: number | null;
}

export interface LayerFreshness {
  /** Время источника, а не время нашего запроса. */
  asOf: string | null;
  ageHours: number | null;
  /** Доля полной вселенной, а не выборки: фильтр не должен улучшать метрику. */
  coveragePct: number;
}

export interface SelectionStatus {
  activeFilters: ActiveFilterState;
  total: number | null;
  passed: number | null;
  dataTiers: Record<Tier, number> | null;
}

export interface EvaluationStatus {
  runId: string;
  createdAt: string;
  evaluationProfileId: string;
  evaluatedCount: number;
  /** Покомпонентно: смена фильтра обесценивает sectorPosition, но не valuation. */
  compatible: { perToken: boolean; comparative: boolean };
}

export interface StatusNextAction extends NextAction {
  why: string;
}

export interface StatusReport {
  job: JobSnapshot;
  data: {
    universe: UniverseFreshness;
    prices: LayerFreshness;
    tokenomics: LayerFreshness;
  };
  selection: SelectionStatus;
  evaluation: EvaluationStatus | null;
  nextAction: StatusNextAction;
}