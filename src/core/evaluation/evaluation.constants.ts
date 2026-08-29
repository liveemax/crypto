import type { Metric } from '../types';
import type { AlphaConfig, NumericField } from '../universe/profile.types';
import type { UniverseCandidate } from '../universe/universe.types';
import { metric } from '../validate/validate.service';
import type { NotEvaluatedComponent } from './evaluation.types';

/**
 * Единственный отложенный компонент композита. Один и тот же список едет в
 * каждый прогон и каждую карточку — ни сети, ни модели он не требует, потому
 * что ничего не считает, а только называет причину и факты-заменители.
 */
export const NOT_EVALUATED: NotEvaluatedComponent[] = [
  {
    id: 'mechanism',
    why: 'Механизм возврата ценности требует чтения документации протокола',
    whatWeMeasureInstead: ['holdersRevenue12mUsd', 'payoutRatioPct', 'holderYieldPct'],
  },
];

/** Границы разводнения за 12 месяцев: low ниже 5%, high выше 15%. */
export const DILUTION_RISK = { low: 5, high: 15 } as const;

/**
 * Абсолютная шкала навеса: применяется, когда ниши для сравнения нет.
 * Навес 0 даёт 100, 100% — 50, 200% и выше — 0.
 */
export const OVERHANG_ABSOLUTE_DIVISOR = 2;

/** Штраф к перцентилю навеса за подтверждённый календарь разлоков. */
export const DILUTION_PENALTY = { high: 15, medium: 7 } as const;

/**
 * Мёртвая зона NHY. Он разность двух процентов из двух независимых источников;
 * минус 0.79% — это шум, а не отрицательная экономика.
 */
export const NHY_NOISE_PCT = 1;

/** Версия сравнительной формулы масштаба бизнеса, сохраняемая с каждым run. */
export const BUSINESS_SCALE_FORMULA_VERSION = 'business-scale-v1';

/** Пороги роли в нише. Таблица заморожена в коде и в профиль не выносится. */
export const ROLE_CUTS = {
  leaderSharePct: 40,
  leaderEfficiency: 60,
  cheapBelow: 30,
  scaleBelow: 50,
  challengerEfficiency: 50,
} as const;

/** Чем меряется эффективность, дешевизна и масштаб: первый доступный перцентиль. */
export const EFFICIENCY_FIELDS: NumericField[] = [
  'holderYieldPct',
  'revenuePerTvlPct',
  'payoutRatioPct',
];
export const CHEAPNESS_FIELDS: NumericField[] = ['pRev', 'pFees'];
export const SCALE_FIELDS: NumericField[] = [
  'revenue12mUsd',
  'fees12mUsd',
  'holdersRevenue12mUsd',
  'mcapCalcUsd',
];

const MARKET_FIELDS: NumericField[] = [
  'mcapCalcUsd',
  'fdvUsd',
  'vol24hUsd',
  'turnoverPct',
  'floatPct',
  'fdvToMcap',
  'overhangPct',
];
const TOKENOMICS_FIELDS: NumericField[] = ['unlock12mPct', 'netHolderYieldPct'];

/** Ось предложения: единственная плотная метрика, годная для сравнения в нише. */
export const SUPPLY_FIELD: NumericField = 'overhangPct';

/**
 * Конфигурация перцентилей для оценки. Отличий от альфы ровно два, и оба
 * следуют из того, что оценка никого не отсекает: ось предложения добавлена,
 * чтобы место в нише было и у токена без выручки, а минимум метрик снижен до
 * одной — одной оси мало, чтобы удалить участника, но достаточно, чтобы
 * назвать его положение. Сколько осей сработало, видно в rankedOn.
 */
export function evaluationRankConfig(config: AlphaConfig): AlphaConfig {
  const hasSupply = config.rankBy.some((item) => item.field === SUPPLY_FIELD);
  return {
    ...config,
    minScoreMetrics: 1,
    rankBy: hasSupply
      ? config.rankBy
      : [...config.rankBy, { field: SUPPLY_FIELD, direction: 'lower_better' }],
  };
}

const UNITS: Record<NumericField, string> = {
  mcapCalcUsd: 'USD',
  fdvUsd: 'USD',
  vol24hUsd: 'USD',
  turnoverPct: '%',
  floatPct: '%',
  fdvToMcap: 'x',
  fees12mUsd: 'USD',
  revenue12mUsd: 'USD',
  holdersRevenue12mUsd: 'USD',
  holderYieldPct: '%',
  takeRatePct: '%',
  payoutRatioPct: '%',
  pRev: 'x',
  pFees: 'x',
  fdvRev: 'x',
  revenuePerTvlPct: '%',
  tvlUsd: 'USD',
  overhangPct: '%',
  unlock12mPct: '%',
  netHolderYieldPct: '%',
};

/**
 * Дата финансовых чисел. Своей даты у сводок DeFiLlama нет ни в теле, ни в
 * заголовках — проверено 28.08.2026, см. CLAUDE.md. Берётся last_updated
 * CoinGecko того же прогона чисел: расхождение до суток, выдумки нет.
 */
export function financialAsOf(candidate: UniverseCandidate): string | null {
  return candidate.marketAsOf;
}

/** Ссылка и дата рядом с числом: каждое поле знает, откуда оно пришло. */
export function provenanceOf(
  candidate: UniverseCandidate,
  field: NumericField,
): { sourceUrl: string | null; asOf: string | null } {
  if (MARKET_FIELDS.includes(field)) {
    return { sourceUrl: candidate.marketSource, asOf: candidate.marketAsOf };
  }
  if (TOKENOMICS_FIELDS.includes(field)) {
    return { sourceUrl: candidate.tokenomicsSource, asOf: candidate.asOfTokenomics };
  }
  if (field === 'tvlUsd') {
    return { sourceUrl: candidate.tvlSource, asOf: financialAsOf(candidate) };
  }
  return { sourceUrl: candidate.revenueSource, asOf: financialAsOf(candidate) };
}

/** Готовая метрика поля кандидата со ссылкой, датой и единицей измерения. */
export function metricOf(candidate: UniverseCandidate, field: NumericField): Metric {
  const { sourceUrl, asOf } = provenanceOf(candidate, field);
  return metric(candidate[field], sourceUrl, asOf, UNITS[field]);
}
