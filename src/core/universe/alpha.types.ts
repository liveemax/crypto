import type { NumericField } from './profile.types';

/**
 * Что альфа решила по участнику. Отсев по конкуренции и отсев по дырам в данных
 * — разные вещи: без раздельных причин второе выглядит как первое.
 */
export type AlphaDecision =
  | 'kept_top_n'
  | 'sector_not_saturated'
  | 'alpha_outranked'
  | 'alpha_unrankable'
  | 'alpha_missing_sector';

export type AlphaStatus =
  | 'sector_leader'
  | 'outranked'
  | 'insufficient_data'
  | 'sector_not_saturated'
  | 'missing_sector';

export interface SectorPercentile {
  field: NumericField;
  direction: 'higher_better' | 'lower_better';
  /** Само число кандидата; остаётся видимым, даже если в перцентиль не пошло. */
  value: number | null;
  /** Скольких конкурентов обошёл, %. null — число неизвестно или сравнивать не с чем. */
  percentile: number | null;
  /** У скольких участников сектора это число есть. */
  ranked: number;
  /** Provenance именно того значения, которое участвовало в сравнении. */
  sourceUrl: string | null;
  asOf: string | null;
}

export interface AlphaView {
  sectorSize: number;
  /** Место среди сравнимых участников; null — сравнить не удалось. */
  rankInSector: number | null;
  businessScaleScore: number | null;
  tvlRank: number | null;
  revenueRank: number | null;
  tvlRanked: number;
  revenueRanked: number;
  tvlSharePct: number | null;
  percentiles: SectorPercentile[];
  /** Доля в выручке сектора: производное поле ответа, не поле кандидата. */
  revenueSharePct: number | null;
  comparisonAvailable: boolean;
  alphaQualified: boolean;
  alphaStatus: AlphaStatus;
  decision: AlphaDecision;
  decisionReason: string;
  /** До двенадцати конкурентов: сектор из трёхсот в строку не кладётся. */
  peers: string[];
}

export interface AlphaSectorSummary {
  sector: string | null;
  size: number;
  /** true — участников больше perSector, только такие секторы режутся. */
  saturated: boolean;
  kept: number;
  dropped: number;
  /** Скольких удалось сравнить: остальные — пробел в данных, а не аутсайдеры. */
  ranked: number;
}

export interface AlphaDataGap {
  coingeckoId: string;
  ticker: string;
  sector: string | null;
  reason: 'alpha_unrankable' | 'alpha_missing_sector';
  availableMetrics: NumericField[];
  missingMetrics: NumericField[];
  note: string;
}
