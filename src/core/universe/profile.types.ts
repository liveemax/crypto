import type { EvaluationComponentName } from '../evaluation/evaluation.types';
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
  // Ранжировать по одному навесу нельзя: токен с навесом 100% и последним
  // разлоком в 2031 году безопаснее токена с навесом 30% и клиффом через месяц.
  'overhangPct',
  'unlock12mPct',
  'netHolderYieldPct',
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
  /** Сколько участников оставлять в перенасыщенном секторе. Меньший сектор не режется. */
  perSector: number;
  /** Минимум известных значений в секторе, чтобы метрика вообще дала перцентиль. */
  minRankedValues: number;
  /** Минимум непустых перцентилей, чтобы участник перенасыщенного сектора был сравним. */
  minScoreMetrics: number;
  /** Реальные поля кандидата; revenueSharePct остаётся производным полем ответа. */
  rankBy: { field: NumericField; direction: 'higher_better' | 'lower_better' }[];
}

export interface AnalysisProfile {
  id: string;
  title: string;
  /** Какую гипотезу проверяет этот набор порогов. Обязательное поле. */
  rationale: string;
  screen: ScreenRule[];
  alpha: AlphaConfig;
  thresholds: { minMcapUsd: number; minAnnualRevenueUsd: number; maxPRev: number };
  /** Кодовые оценки: считаются локально, без сети и без модели. */
  codeEvaluations: EvaluationComponentName[];
  /** Ключи совпадают с именами кодовых компонентов посимвольно. */
  weights: Record<string, number>;
  tierCuts: { a: number; b: number; minDataQuality: number };
}
