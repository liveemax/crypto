/**
 * Состояние календаря разлоков. Пробел имеет тип: «источник нас не знает» и
 * «эмиссии не будет» — разные утверждения, и второе стоит денег.
 */
export type TokenomicsDataState =
  | 'available'
  | 'known_zero'
  | 'mapping_failed'
  | 'source_missing'
  | 'source_stale'
  | 'source_error'
  /**
   * Документ найден, но число из него не берётся: пробел в расписании,
   * нераспознанная сумма или расхождение с итогом источника.
   */
  | 'matched_unparsed';

export type UnlockCategory =
  | 'team'
  | 'investors'
  | 'community'
  | 'ecosystem'
  | 'other'
  | 'unknown';

export type UnlockOrigin = 'provider' | 'manual';

export type TokenomicsMatch =
  | 'coingecko_id'
  | 'contract'
  | 'provider_id'
  | 'symbol'
  | 'none';

/** Разовый разлок: количество известно и привязано к дате. */
export interface UnlockEvent {
  date: string;
  tokens: number;
  category: UnlockCategory;
  origin: UnlockOrigin;
  sourceUrl: string;
  asOf: string;
}

/**
 * Линейный поток: источник даёт ставку в неделю до endTimestamp, а не
 * количество. Отдельный тип обязателен — сложенный с клиффами как однородное
 * событие, четырёхлетний вестинг посчитается одним днём.
 */
export interface UnlockStream {
  recipient: string;
  category: UnlockCategory;
  startsAt: string;
  endsAt: string;
  tokensPerWeek: number;
  origin: UnlockOrigin;
  sourceUrl: string;
  asOf: string;
}

export interface TokenomicsFacts {
  coingeckoId: string;
  ticker: string;
  provider: string | null;
  providerId: string | null;
  matchedBy: TokenomicsMatch;
  state: TokenomicsDataState;
  /** Только будущие клиффы: прошлое уже сидит в circulating. */
  events: UnlockEvent[];
  streams: UnlockStream[];
  /** Доля эмиссии без расписания. Выше 5% — число не принимается. */
  tbdPct: number | null;
  /** Расписание покрывает столько процентов maxSupply. */
  schedulePct: number | null;
  /** Поток помечен источником как прогноз: это эмиссия, а не вестинг. */
  includesForecast: boolean;
  sourceUrl: string | null;
  asOf: string | null;
  note: string;
}

/** Файл фактов: пересчёт производных чисел не требует ни одного запроса. */
export interface TokenomicsSnapshot {
  universeVersion: string;
  collectedAt: string;
  provider: string;
  documentsScanned: number;
  facts: TokenomicsFacts[];
  warnings: string[];
}

/** Карта идентификаторов провайдера. Живёт столько же, сколько состав вселенной. */
export interface EmissionsIndex {
  universeVersion: string;
  builtAt: string;
  documents: number;
  slugs: string[];
  byGecko: Record<string, string[]>;
  /** Слаги, чей документ не отдался: молча пропавший отсев выглядит работающим. */
  failed: string[];
  /** Карта взята из кэша после отказа источника: новых проектов в ней нет. */
  stale?: boolean;
}

/**
 * Поля кандидата, которые заполняет шаг 09. Один объект — один источник правды
 * о наборе: EMPTY_TOKENOMICS, калькулятор и фикстуры не разъедутся.
 */
export interface TokenomicsFields {
  /** Навес: считается из снимка, известен почти у всех, календаря не требует. */
  overhangPct: number | null;
  unlockEventsCount: number | null;
  unlockTokens30d: number | null;
  unlockTokens90d: number | null;
  unlockTokens365d: number | null;
  unlock30dPct: number | null;
  unlock90dPct: number | null;
  unlock12mPct: number | null;
  netHolderYieldPct: number | null;
  nextUnlockAt: string | null;
  nextUnlockUsd: number | null;
  nextUnlockCostInDailyVolumes: number | null;
  /** Доля эмиссии без расписания: выше 5% число не принимается. */
  tokenomicsTbdPct: number | null;
  tokenomicsState: TokenomicsDataState;
  tokenomicsSource: string | null;
  asOfTokenomics: string | null;
}