import type { Tier } from './universe.types';

export const NUMERIC_FIELDS = [
  'mcapCalcUsd',
  'fdvUsd',
  'vol24hUsd',
  'turnoverPct',
  'floatPct',
  'fdvToMcap',
  'fees12mUsd',
  'revenue12mUsd',
  'holdersRevenue12mUsd',
  'holderYieldPct',
  'takeRatePct',
  'payoutRatioPct',
  'pRev',
  'pFees',
  'revenuePerTvlPct',
  'tvlUsd',
] as const;

export type NumericField = (typeof NUMERIC_FIELDS)[number];

export type ScreenRule =
  | {
      stage: string;
      label: string;
      kind: 'compare';
      field: NumericField;
      op: 'gte' | 'lte';
      value: number;
      /** null проходит: «неизвестно» не равно «плохо». */
      nullPolicy: 'pass' | 'fail';
    }
  /** Проверки, не выражаемые полем и оператором: множество, коридор, регулярка, флаг. */
  | {
      stage: string;
      label: string;
      kind: 'excluded' | 'pegged' | 'derivative' | 'healthy';
    };

export interface AlphaConfig {
  /** Сколько лидеров брать из сектора. */
  perSector: number;
  /** Сектор меньше этого размера лидеров не выделяет. */
  minSectorSize: number;
  /** Тиры, участвующие в ранжировании. */
  includeTiers: Tier[];
  /** Абсолютный порог: лидер обязан быть не только первым, но и приемлемым. */
  qualify: ScreenRule[];
  /** По каким метрикам считать перцентили внутри сектора. */
  rankBy: { field: NumericField; direction: 'higher_better' | 'lower_better' }[];
  /** Крупные токены без экономики — отдельный список на ручной сбор данных. */
  manualCandidates: ScreenRule[];
}

export interface AnalysisProfile {
  id: string;
  title: string;
  /** Какую гипотезу проверяет этот набор порогов. Обязательное поле. */
  rationale: string;
  screen: ScreenRule[];
  alpha: AlphaConfig;
  thresholds: { minMcapUsd: number; minAnnualRevenueUsd: number; maxPRev: number };
  /** Какие модули запускать. Отсутствующие не участвуют в композите. */
  agents: string[];
  weights: Record<string, number>;
  tierCuts: { a: number; b: number; minDataQuality: number };
}
