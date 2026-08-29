/**
 * Число с происхождением. Без sourceUrl и asOf валидатор его обнуляет: это код,
 * а не договорённость. Метрики создаются только через metric().
 */
export interface Metric {
  value: number | string | null;
  unit: string;
  sourceUrl: string | null;
  asOf: string | null;
  droppedReason?: 'no_source' | 'no_as_of';
  staleDays?: number;
}
