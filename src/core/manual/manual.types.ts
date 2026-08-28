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