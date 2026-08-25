import type { AnalysisProfile } from './profile.types';

export type RevenueBasis = 'reported_1y' | 'run_rate_30d' | 'none';
export type MatchSource = 'gecko_id' | 'chain' | 'override' | 'none';

/**
 * Тир кандидата.
 * yield — выручка доходит до держателей токена, это цель системы;
 * economics — выручка есть, но до держателей не доходит или неизвестно;
 * pool — шлак-фильтр пройден, финансового источника нет;
 * rejected — отсеян.
 */
export type Tier = 'yield' | 'economics' | 'pool' | 'rejected';

/** Кандидат вселенной: все числа посчитаны кодом и снабжены ссылкой на источник. */
export interface UniverseCandidate {
  rank: number;
  coingeckoId: string;
  ticker: string;
  name: string;

  priceUsd: number | null;
  circulating: number | null;
  totalSupply: number | null;
  /** Капитализация, посчитанная нами: price × circulating. */
  mcapCalcUsd: number | null;
  /** Капитализация, заявленная CoinGecko, — для сверки, а не для расчётов. */
  mcapReportedUsd: number | null;
  mcapDivergencePct: number | null;
  fdvUsd: number | null;
  vol24hUsd: number | null;
  /** Оборот за сутки в процентах от капитализации. */
  turnoverPct: number | null;
  /** Доля эмиссии в обращении: circulating / totalSupply. */
  floatPct: number | null;
  /** Во сколько раз полная оценка больше текущей: навес будущего предложения. */
  fdvToMcap: number | null;
  marketSource: string | null;
  marketAsOf: string | null;

  defillamaSlugs: string[];
  sector: string | null;
  matchedBy: MatchSource | 'symbol';
  tvlUsd: number | null;
  tvlSource: string | null;

  /** Комиссии, уплаченные пользователями за 12 месяцев. */
  fees12mUsd: number | null;
  /** Валовая прибыль протокола: комиссии минус выплаты поставщикам капитала. */
  revenue12mUsd: number | null;
  /** Часть выручки, дошедшая до держателей токена: выкуп, стейкинг, fee switch. */
  holdersRevenue12mUsd: number | null;
  revenue30dUsd: number | null;
  holdersRevenue30dUsd: number | null;
  revenueBasis: RevenueBasis;
  revenueSource: string | null;
  /** false — адаптер DeFiLlama сломан, числа устарели. */
  sourceHealthy: boolean;

  /** Доходность держателя: holdersRevenue за 12 месяцев к капитализации. */
  holderYieldPct: number | null;
  /** Доля комиссий, остающаяся у протокола: revenue / fees. */
  takeRatePct: number | null;
  /** Доля выручки, доходящая до держателей: holdersRevenue / revenue. */
  payoutRatioPct: number | null;
  pRev: number | null;
  pFees: number | null;
  fdvRev: number | null;
  revenuePerTvlPct: number | null;

  tier: Tier;
  passed: boolean;
  rejectedAt: string | null;
  rejectReason: string | null;
}

export interface FunnelStage {
  stage: string;
  /** Человекочитаемое описание проверки на русском. */
  label: string;
  incoming: number;
  dropped: number;
  kept: number;
}

export interface FunnelReport {
  total: number;
  stages: FunnelStage[];
  passed: number;
  /** Распределение прошедших по тирам. */
  tiers: Record<Tier, number>;
}

export type UniverseStep =
  | 'idle'
  | 'markets'
  | 'categories'
  | 'protocols'
  | 'chains'
  | 'fees'
  | 'prices'
  | 'join'  
  | 'filter'
  | 'save'
  | 'done'
  | 'failed';

/** Счётчик пересборки: на каком шаге, сколько сделано, не лёг ли источник. */
export interface UniverseProgress {
  step: UniverseStep;
  label: string;
  /** Сколько единиц шага завершено, например страниц рынка. */
  current: number;
  total: number;
  percent: number;
  /** Сколько строк загружено к этому моменту. */
  loaded: number;
  /** Сколько запросов завершились ошибкой. */
  failures: number;
  lastError: string | null;
  startedAt: string | null;
  elapsedSec: number;
  etaSec: number | null;
}

/** Событие прогресса, которое билдер отдаёт наружу. */
export interface BuildProgressEvent {
  step: UniverseStep;
  label: string;
  current: number;
  total: number;
  loaded: number;
  failed: boolean;
  error: string | null;
}

export interface UniverseSnapshot {
  /** Дата сборки состава вселенной, она же ключ сопоставимости прогонов. */
  version: string;
  builtAt: string;
  topN: number;
  sources: Record<string, string>;
  candidates: UniverseCandidate[];
  /** Идентификаторы из реестров исключений: нужны для повторного отбора без сети. */
  excludedIds: string[];
  /** Профиль, которым считался funnel в момент сборки. */
  profileId: string;
  funnel: FunnelReport;
  /** Что не сошлось: пустые страницы, расхождения, незаматченные монеты. */
  warnings: string[];
}

export interface UniverseStatus {
  state: 'idle' | 'running' | 'error';
  progress: UniverseProgress;
  error: string | null;
  version: string | null;
  ageDays: number | null;
  total: number | null;
  passed: number | null;
  tiers: Record<Tier, number> | null;
}

export interface UniverseRefreshResult {
  started: boolean;
  reason: 'fresh' | 'stale' | 'never_built' | 'already_running' | 'forced';
  ageDays: number | null;
  message: string;
}

export interface ProfileSelection {
  profileId?: string;
  profile?: AnalysisProfile;
}

export type ProfileReference = string | AnalysisProfile | ProfileSelection;

export interface UniverseScreenResult {
  universeVersion: string;
  builtAt: string;
  profile: AnalysisProfile;
  funnel: FunnelReport;
  candidates: UniverseCandidate[];
}

export interface CandidateRef {
  coingeckoId: string;
  ticker: string;
}

export interface TierChange extends CandidateRef {
  left: Tier;
  right: Tier;
}

export interface UniverseCompareResult {
  universeVersion: string;
  builtAt: string;
  left: { profile: AnalysisProfile; funnel: FunnelReport };
  right: { profile: AnalysisProfile; funnel: FunnelReport };
  both: CandidateRef[];
  onlyLeft: CandidateRef[];
  onlyRight: CandidateRef[];
  tierChanges: TierChange[];
}
