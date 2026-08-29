import type { PageQuery } from '../envelope.types';
import type { AssetArchetype } from './comparison.types';

export type GapField = 'revenue' | 'tokenomics' | 'comparisonGroup';

export interface DataGapItem {
  field: GapField;
  /** Тип пробела: known_zero сюда не попадает — подтверждённый ноль это измерение. */
  state: string;
  note: string;
  /** Что закроет пробел. Очередь задач без задачи — просто список. */
  fix: string;
}

export interface DataGapRow {
  coingeckoId: string;
  ticker: string;
  name: string;
  mcapCalcUsd: number | null;
  assetArchetype: AssetArchetype;
  comparisonGroup: string | null;
  sector: string | null;
  matchedBy: string;
  /** Прошёл ли строку рабочий отбор: пробел не отсев, и наоборот. */
  passed: boolean;
  gaps: DataGapItem[];
}

export interface DataGapQuery extends PageQuery {
  passedOnly?: boolean;
  dataState?: string;
  assetArchetype?: string;
  comparisonGroup?: string;
  field?: GapField;
}