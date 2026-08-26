import type { ActiveFilterState } from './filter-state.types';
import type { DataState } from './comparison.types';

/** Доля по числу и по деньгам сразу: десять процентов монет бывают половиной капитализации. */
export interface CoverageBucket {
  key: string;
  count: number;
  pct: number;
  mcapUsd: number;
  mcapPct: number;
}

export interface CoverageGap {
  coingeckoId: string;
  ticker: string;
  mcapCalcUsd: number | null;
  /** Категория DeFiLlama, если была: пусто почти всегда — иначе группа бы нашлась. */
  sector: string | null;
  matchedBy: string;
  revenueState: DataState;
}

export interface SectorCoverage {
  withGroup: number;
  withoutGroup: number;
  gapPct: number;
  gapMcapPct: number;
  maxGapPct: number;
  maxGapMcapPct: number;
  /** false — гейт красный. Проверяются оба порога, достаточно провалить один. */
  passed: boolean;
  /** Худшие пробелы по капитализации: с них начинается работа. */
  worst: CoverageGap[];
}

export interface CoverageReport {
  universeVersion: string;
  builtAt: string;
  activeFilters: ActiveFilterState;
  /** База: вход альфы. Сама альфа при подсчёте всегда выключена. */
  total: number;
  totalMcapUsd: number;
  sector: SectorCoverage;
  /** Гейта нет: сетям нужны свои метрики, это шаг 06.2. */
  revenue: { byState: CoverageBucket[]; gated: false };
  archetypes: CoverageBucket[];
  /** Размеры групп: видно, какие ниши вообще насыщены. */
  groups: { group: string; size: number }[];
  warnings: string[];
}