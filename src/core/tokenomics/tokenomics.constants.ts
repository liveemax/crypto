import type { TokenomicsFields } from './tokenomics.types';

/** Список слагов с календарём. Публичный датасет, ключа не требует. */
export const EMISSIONS_LIST_URL =
  'https://defillama-datasets.llama.fi/emissionsProtocolsList';

/** Документ протокола: события лежат в metadata.unlockEvents. */
export function emissionsDocumentUrl(slug: string): string {
  return `https://defillama-datasets.llama.fi/emissions/${encodeURIComponent(slug)}`;
}

/** Ссылка для человека: её открывают и сверяют событие руками. */
export function unlocksPageUrl(slug: string): string {
  return `https://defillama.com/unlocks/${slug}`;
}

export const PROVIDER = 'defillama-emissions';
export const TOKENOMICS_SNAPSHOT = 'tokenomics-facts';
export const INDEX_CACHE_NS = 'tokenomics-index';
/** Карта живёт сроком вселенной: ключ кэша — universeVersion, поэтому TTL длинный. */
export const INDEX_TTL_DAYS = 3_650;
/** Повтор в течение суток не ходит в сеть. */
export const REFRESH_TTL_HOURS = 24;

export const WEEK_SECONDS = 604_800;
export const DAY_SECONDS = 86_400;
export const HORIZON_DAYS = { short: 30, medium: 90, long: 365 } as const;

/** Доля эмиссии без графика, выше которой число не принимается. */
export const MAX_TBD_PCT = 5;
/** Расписание закрыто настолько — ноль впереди законен. */
export const SCHEDULE_COMPLETE_PCT = 99;
/** Столько уже в обращении — ноль впереди законен и без расписания. */
export const FLOAT_COMPLETE_PCT = 90;
/** Расхождение суммы клиффов с итогом источника: выше — отказ по токену. */
export const CLIFF_MISMATCH_PCT = 0.5;
/** Расхождение ручного значения с провайдером, после которого оно уходит в note. */
export const MANUAL_CONFLICT_RATIO = 2;
/** Документов одновременно: CDN без лимита, но топить его незачем. */
export const DOCUMENT_POOL = 6;

/**
 * Состояние до первого прогона. Не 'available' с нулями: «источник не
 * спрашивали» неотличимо от «источник нас не знает», и оба — не ноль.
 */
export const EMPTY_TOKENOMICS: TokenomicsFields = {
  overhangPct: null,
  unlockEventsCount: null,
  unlockTokens30d: null,
  unlockTokens90d: null,
  unlockTokens365d: null,
  unlock30dPct: null,
  unlock90dPct: null,
  unlock12mPct: null,
  netHolderYieldPct: null,
  nextUnlockAt: null,
  nextUnlockUsd: null,
  nextUnlockCostInDailyVolumes: null,
  tokenomicsTbdPct: null,
  tokenomicsState: 'source_missing',
  tokenomicsSource: null,
  asOfTokenomics: null,
};