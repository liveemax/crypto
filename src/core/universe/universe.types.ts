import type { AnalysisProfile } from './profile.types';
import type { ActiveFilterState, FilterName } from './filter-state.types';
import type { JobProgressEvent, JobStep } from '../jobs/job.types';
import type { PageQuery, ResponseContext } from '../envelope.types';
import type { AlphaDataGap, AlphaSectorSummary, AlphaView } from './alpha.types';
import type { AssetArchetype, DataState } from './comparison.types';
import type { TokenomicsFields } from '../tokenomics/tokenomics.types';

export type RevenueBasis = 'reported_1y' | 'run_rate_30d' | 'none';
export type MatchSource = 'gecko_id' | 'chain' | 'override' | 'none';

/** Поля сортировки списка ШАГ 1: summary-метрики плюс businessScaleScore альфы. */
export const UNIVERSE_SORT_FIELDS = [
  'rank',
  'mcapCalcUsd',
  'vol24hUsd',
  'tvlUsd',
  'revenue12mUsd',
  'holdersRevenue12mUsd',
  'holderYieldPct',
  'pRev',
  'pFees',
  'overhangPct',
  'unlock12mPct',
  'netHolderYieldPct',
  'businessScaleScore',
] as const;
export type UniverseSortField = (typeof UNIVERSE_SORT_FIELDS)[number];

/** rank и мультипликаторы дешевизны — по возрастанию; остальные метрики — по убыванию. */
export const UNIVERSE_SORT_ASC_DEFAULT: ReadonlySet<UniverseSortField> = new Set([
  'rank',
  'pRev',
  'pFees',
]);

/**
 * Тир данных кандидата — не тир рейтинга (см. RankTier в core/ranking).
 * yield — выручка доходит до держателей токена, это цель системы;
 * economics — выручка есть, но до держателей не доходит или неизвестно;
 * pool — шлак-фильтр пройден, финансового источника нет;
 * rejected — отсеян.
 */
export type DataTier = 'yield' | 'economics' | 'pool' | 'rejected';

/**
 * Кандидат вселенной: все числа посчитаны кодом и снабжены ссылкой на источник.
 * Разлоки приходят из TokenomicsFields: это такой же внешний факт, как выручка,
 * и живёт он там же, а не в оценке, которой иначе пришлось бы ходить в сеть.
 */
export interface UniverseCandidate extends TokenomicsFields {
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
  /** Категория DeFiLlama как пришла: способ зарабатывать, а не тема. */
  sector: string | null;
  /** Категории CoinGecko из карты, в которых состоит монета. */
  rawSectors: string[];
  /**
   * Группа прямых конкурентов, по которой сравнивает альфа. null — сравнивать
   * не с кем: это пробел покрытия, а не вердикт о токене.
   */
  comparisonGroup: string | null;
  assetArchetype: AssetArchetype;
  /** Почему выручка такая, какая есть. Ноль с источником — не отсутствие. */
  revenueState: DataState;
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

  tier: DataTier;
  passed: boolean;
  rejectedAt: string | null;
  rejectReason: string | null;
}

export interface FunnelStage {
  /** Какой фильтр отсеял: без него отсев по данным неотличим от отсева по существу. */
  filter: FilterName;
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
  tiers: Record<DataTier, number>;
}

/**
 * Словарь шагов и событие прогресса принадлежат JobService: состояние задачи
 * живёт в одном сервисе, а имена здесь оставлены, чтобы импорты не переписывать.
 */
export type UniverseStep = JobStep;

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
export type BuildProgressEvent = JobProgressEvent;

export interface UniverseSnapshot {
  /** Дата сборки состава вселенной, она же ключ сопоставимости прогонов. */
  version: string;
  builtAt: string;
  topN: number;
  sources: Record<string, string>;
  candidates: UniverseCandidate[];
  /** Идентификаторы из реестров исключений: нужны для повторного отбора без сети. */
  excludedIds: string[];
  /**
   * @deprecated Профиль сборки. Не пишется и не читается: истина — activeFilters.
   * Поле оставлено, чтобы снимки прежнего формата загружались без пересборки.
   */
  profileId?: string;
  /** @deprecated Воронка на момент сборки. Истина — композиция активных фильтров. */
  funnel?: FunnelReport;
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
  tiers: Record<DataTier, number> | null;
  /** Чем получены passed и tiers. Композиция независимых фильтров, а не одно имя. */
  activeFilters: ActiveFilterState;
  /** @deprecated Алиас activeFilters.screen.profileId. */
  profileId: string | null;
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

/** Кандидат плюс решение фильтров о нём. Представление, а не мутация фактов. */
export interface CandidateView extends UniverseCandidate {
  /** null — фильтр альфы выключен: сравнения не было, а не «сравнили и никак». */
  alpha: AlphaView | null;
}

/** Текущий результат: факты снимка плюс решения всех включённых фильтров. */
export interface UniverseView {
  universeVersion: string;
  builtAt: string;
  activeFilters: ActiveFilterState;
  funnel: FunnelReport;
  candidates: CandidateView[];
  /** Сводка альфы, если она включена. */
  sectors: AlphaSectorSummary[];
  dataGaps: AlphaDataGap[];
  warnings: string[];
}

/** Ответ на включение или выключение одного фильтра. */
export interface ScreenApplyResult {
  universeVersion: string;
  builtAt: string;
  activeFilters: ActiveFilterState;
  /** Кандидатов на входе фильтра. */
  before: number;
  /** Кандидатов после него — оно же status.passed. */
  after: number;
  funnel: FunnelReport;
}

export interface AlphaApplyResult {
  universeVersion: string;
  builtAt: string;
  activeFilters: ActiveFilterState;
  /** Вход альфы: survivors screen, а при выключенном screen — весь снимок. */
  before: number;
  after: number;
  dropped: number;
  sectors: AlphaSectorSummary[];
  /** Страница очереди пробелов; полное число — в dataGapsTotal. */
  dataGaps: AlphaDataGap[];
  dataGapsTotal: number;
  funnel: FunnelReport;
  warnings: string[];
  /** Уже пересчитанный статус: второй запрос за тем же числом не нужен. */
  status: UniverseStatus;
}

export interface CandidateRef {
  coingeckoId: string;
  ticker: string;
}

export interface TierChange extends CandidateRef {
  left: DataTier;
  right: DataTier;
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

/** Запрос списка кандидатов. Сортировка и фильтры — через query, а не на клиенте. */
export interface UniverseListQuery extends PageQuery {
  passedOnly?: boolean;
  tier?: DataTier;
  sector?: string;
  /** Регистронезависимая подстрока по name, ticker и coingeckoId. */
  q?: string;
  sort?: UniverseSortField;
  /** Без явного значения — дефолт поля из UNIVERSE_SORT_ASC_DEFAULT. */
  order?: 'asc' | 'desc';
  /** summary по умолчанию: percentiles и peers пятидесяти строк — половина веса ответа. */
  view?: 'summary' | 'full';
}

/** Список секторов текущей вселенной для тулбара фильтров: не страница, а весь снимок. */
export interface UniverseOptionsResponse {
  context: ResponseContext;
  sectors: string[];
}