import type { AlphaConfig, NumericField } from './profile.types';
import type { MatchSource, Tier } from './universe.types';

/** Участник сектора: минимум, по которому его находят в GET /universe. */
export interface SectorMember {
  coingeckoId: string;
  ticker: string;
  name: string;
  tier: Tier;
}

export interface SectorPercentile {
  field: NumericField;
  direction: 'higher_better' | 'lower_better';
  /** Само число кандидата. Остаётся видимым, даже если в перцентиль не пошло. */
  value: number | null;
  /**
   * Скольких конкурентов сектора обошёл, в процентах. Равные делят место пополам.
   * null — число неизвестно или сравнивать не с чем; это не ноль.
   */
  percentile: number | null;
  /** У скольких участников сектора это число есть. */
  ranked: number;
}

export interface SectorLeader extends SectorMember {
  sector: string;
  /** Место среди прошедших qualify, 1 — первый. */
  rankInSector: number;
  /** Участников сектора, с которыми считались перцентили. */
  sectorSize: number;
  /** Сколько участников сектора прошли абсолютный порог. */
  qualifiedInSector: number;
  /** Среднее доступных перцентилей. */
  sectorScore: number;
  percentiles: SectorPercentile[];
  /** Доля в выручке сектора: revenue12mUsd к сумме выручки участников. */
  revenueSharePct: number | null;
  mcapCalcUsd: number | null;
  revenue12mUsd: number | null;
  holdersRevenue12mUsd: number | null;
  holderYieldPct: number | null;
  pRev: number | null;
  revenueSource: string | null;
  marketAsOf: string | null;
  /** Тикеры конкурентов, с которыми шло сравнение; сам лидер в список не входит. */
  peers: string[];
}

export interface SectorWithoutComparison {
  /** null — сектор не определён: протокол не найден или у группы нет категории. */
  sector: string | null;
  reason: 'too_small' | 'unknown_sector';
  size: number;
  members: SectorMember[];
  /** Почему лидера здесь не выделяем. */
  note: string;
}

export interface ManualDataCandidate extends SectorMember {
  sector: string | null;
  mcapCalcUsd: number | null;
  vol24hUsd: number | null;
  matchedBy: MatchSource | 'symbol';
  defillamaSlugs: string[];
  /** Чего именно не хватает, чтобы система могла что-то сказать. */
  reason: string;
}

export interface AlphaTotals {
  /** Прошло отбор профиля. */
  passed: number;
  /** Из них участвуют в перцентилях: тиры с финансовыми числами. */
  ranked: number;
  /** Секторов с определённым названием среди ranked. */
  sectors: number;
  /** Из них не меньше minSectorSize. */
  sectorsRanked: number;
  /** Секторов, где сравнение невозможно: мало участников или сектор неизвестен. */
  sectorsWithoutComparison: number;
  /** Секторов, где участники есть, но абсолютный порог не прошёл никто. */
  sectorsWithoutLeaders: number;
  leaders: number;
  /** Полное число кандидатов на ручной сбор данных, до применения limit. */
  needsManualData: number;
}

export interface AlphaReport {
  universeVersion: string;
  builtAt: string;
  profileId: string;
  /** Чем считали: без параметров альфы выдача непроверяема и несравнима. */
  alpha: AlphaConfig;
  totals: AlphaTotals;
  leaders: SectorLeader[];
  sectorsWithoutComparison: SectorWithoutComparison[];
  needsManualData: ManualDataCandidate[];
  /** Что не сошлось: выбросы, тиры без чисел, секторы без лидеров. */
  warnings: string[];
}