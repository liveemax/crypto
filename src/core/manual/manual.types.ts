import type { UnlockCategory } from '../tokenomics/tokenomics.types';

export interface ManualUnlockInput {
  ticker: string;
  date: string;
  tokens: number;
  category: UnlockCategory;
  sourceUrl: string;
  /** Дата документа-источника. Без неё метрика обнуляется валидатором. */
  asOf: string;
}

export interface ManualUnlockRecord extends ManualUnlockInput {
  id: string;
  coingeckoId: string;
  createdAt: string;
}

/** Стимулы не приходят ни из CoinGecko, ни из сводок DeFiLlama: только ручной ввод. */
export interface ManualIncentiveOverrideInput {
  /** Стоимость раздаваемых токенов за 12 месяцев в USD. Подтверждённый ноль допустим. */
  incentives12mUsd: number;
  sourceUrl: string;
  /** Дата документа-источника, а не время записи. */
  asOf: string;
}

export interface ManualIncentiveOverrideRecord extends ManualIncentiveOverrideInput {
  coingeckoId: string;
  ticker: string;
  origin: 'manual';
  createdAt: string;
}

/**
 * Ответ на чтение: identity едет рядом с override, потому что Nest не умеет
 * буквально ответить телом `null` — пустой результат неотличим от него без
 * обёртки. Запись отсутствует — легитимное состояние, а не ошибка.
 */
export interface ManualIncentiveOverrideLookup {
  coingeckoId: string;
  ticker: string;
  override: ManualIncentiveOverrideRecord | null;
}