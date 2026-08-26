import { DISCOVERY } from './discovery';
import type { AnalysisProfile, ScreenRule } from '../core/universe/profile.types';

const BASE_SCREEN: ScreenRule[] = [
  {
    stage: 'market_known',
    label: 'Известны цена и circulating supply',
    kind: 'compare',
    field: 'mcapCalcUsd',
    op: 'gte',
    // mcapCalcUsd округлена до центов: 0.01 эквивалентно прежней проверке > 0.
    value: 0.01,
    nullPolicy: 'fail',
  },
  {
    stage: 'not_excluded',
    label: 'Не стейблкоин, не обёртка, не LST-репрезентация, не мемкоин',
    kind: 'excluded',
  },
  {
    stage: 'not_pegged',
    label: `Цена не привязана к 1 USD (коридор ±${DISCOVERY.pegBandPct}%)`,
    kind: 'pegged',
  },
  {
    stage: 'not_derivative',
    label: 'Не производная обёртка: wrapped, staked, bridged, peg',
    kind: 'derivative',
  },
  {
    stage: 'liquid',
    label:
      `Суточный объём не ниже ` +
      `${DISCOVERY.minVol24hUsd.toLocaleString('ru-RU')} USD`,
    kind: 'compare',
    field: 'vol24hUsd',
    op: 'gte',
    value: DISCOVERY.minVol24hUsd,
    nullPolicy: 'fail',
  },
  {
    stage: 'turnover',
    label: `Оборот не ниже ${DISCOVERY.minTurnoverPct}% капитализации за сутки`,
    kind: 'compare',
    field: 'turnoverPct',
    op: 'gte',
    value: DISCOVERY.minTurnoverPct,
    nullPolicy: 'fail',
  },
  {
    stage: 'float_sane',
    label: `В обращении не меньше ${DISCOVERY.minFloatPct}% эмиссии`,
    kind: 'compare',
    field: 'floatPct',
    op: 'gte',
    value: DISCOVERY.minFloatPct,
    nullPolicy: 'pass',
  },
  {
    stage: 'source_healthy',
    label: 'Финансовый источник не сломан',
    kind: 'healthy',
  },
  {
    stage: 'not_loss_making',
    label: 'Предохранитель: выручка не отрицательная',
    kind: 'compare',
    field: 'revenue12mUsd',
    op: 'gte',
    value: 0,
    nullPolicy: 'pass',
  },
];

/**
 * Альфа — cap, а не второй screen: абсолютных порогов здесь нет намеренно.
 * minRankedValues 3 — перцентиль из двух известных чисел это 0 и 100, а не измерение.
 * minScoreMetrics 2 — по одной метрике из шести место в нише не присуждается.
 *
 * Метрики идут парами «масштаб + оценка», потому что одиночная метрика правило
 * двух не проходит: у сети есть комиссии, но нет ни выручки, ни TVL, и без пары
 * fees12mUsd + pFees она остаётся несравнимой при полностью измеренной экономике.
 *
 * Комиссии — валовый оборот, выручка — то, что осталось протоколу: pFees 5 и
 * pRev 5 разные вещи. Смешения при этом нет — перцентиль каждой метрики
 * считается только среди тех, у кого она есть. На прогоне 26.08 fees12mUsd и
 * pFees оказались общей линейкой всех сравнимых участников каждой ниши, а
 * выручка добавляется сверху там, где измерена.
 */
const DEFAULT_ALPHA: AnalysisProfile['alpha'] = {
  perSector: 5,
  minRankedValues: 3,
  minScoreMetrics: 2,
  rankBy: [
    { field: 'holderYieldPct', direction: 'higher_better' },
    { field: 'holdersRevenue12mUsd', direction: 'higher_better' },
    { field: 'revenue12mUsd', direction: 'higher_better' },
    { field: 'pRev', direction: 'lower_better' },
    { field: 'fees12mUsd', direction: 'higher_better' },
    { field: 'pFees', direction: 'lower_better' },
    { field: 'revenuePerTvlPct', direction: 'higher_better' },
  ],
};

/**
 * Та же механика, другой порядок вопросов: сначала дешевизна, потом масштаб.
 * Порядок на балл не влияет — sectorScore это среднее доступных перцентилей, —
 * но он виден в отчёте и объясняет, чем профиль отличается от базового.
 */
const DEEP_VALUE_ALPHA: AnalysisProfile['alpha'] = {
  ...DEFAULT_ALPHA,
  rankBy: [
    { field: 'pRev', direction: 'lower_better' },
    { field: 'pFees', direction: 'lower_better' },
    { field: 'revenuePerTvlPct', direction: 'higher_better' },
    { field: 'revenue12mUsd', direction: 'higher_better' },
    { field: 'fees12mUsd', direction: 'higher_better' },
    { field: 'holderYieldPct', direction: 'higher_better' },
    { field: 'holdersRevenue12mUsd', direction: 'higher_better' },
  ],
};

const AGENTS = ['screener', 'unlocks', 'sector-position', 'mechanism', 'critic'];
const WEIGHTS = { unlocks: 0.35, mechanism: 0.25, screener: 0.2, sectorPosition: 0.2 };
const TIER_CUTS = { a: 70, b: 45, minDataQuality: 0.5 };
const THRESHOLDS = {
  minMcapUsd: 50_000_000,
  minAnnualRevenueUsd: 1_000_000,
  maxPRev: 60,
};

export const DEFAULT_PROFILE = {
  id: 'default',
  title: 'Базовый',
  rationale: 'Повторяет шлак-фильтр исходной вселенной без оценочных порогов.',
  screen: BASE_SCREEN,
  alpha: DEFAULT_ALPHA,
  thresholds: THRESHOLDS,
  agents: AGENTS,
  weights: WEIGHTS,
  tierCuts: TIER_CUTS,
} satisfies AnalysisProfile;

export const YIELD_HUNTER_PROFILE: AnalysisProfile = {
  ...DEFAULT_PROFILE,
  id: 'yield-hunter',
  title: 'Доходность держателя',
  rationale:
    'Проверяет гипотезу, что токен стоит внимания, когда держатели уже получают ' +
    'заметную долю выручки протокола.',
  screen: [
    ...BASE_SCREEN,
    // 'pass': монета без финансовых данных не провалила порог — её не измеряли.
    // Она остаётся в тире pool; в перенасыщенном секторе альфа пометит её
    // alpha_unrankable и отправит в dataGaps, в маленьком — оставит как есть.
    rule('holder_yield', 'Доходность держателя не ниже 1%', 'holderYieldPct', 'gte', 1, 'pass'),
    rule(
      'payout_ratio',
      'Держателям идёт не меньше 20% выручки',
      'payoutRatioPct',
      'gte',
      20,
      'pass',
    ),
  ],
};

export const DEEP_VALUE_PROFILE: AnalysisProfile = {
  ...DEFAULT_PROFILE,
  id: 'deep-value',
  title: 'Дешевизна к выручке',
  rationale:
    'Проверяет гипотезу, что интересны недорогие относительно выручки токены ' +
    'с достаточным take rate и уже выпущенной частью эмиссии.',
  screen: [
    ...BASE_SCREEN.map((screenRule) =>
      screenRule.stage === 'float_sane'
        ? { ...screenRule, label: 'В обращении не меньше 30% эмиссии', value: 30 }
        : screenRule,
    ),
    rule('deep_value_p_rev', 'P/Rev не выше 15', 'pRev', 'lte', 15, 'pass'),
    rule('deep_value_take_rate', 'Take rate не ниже 10%', 'takeRatePct', 'gte', 10, 'pass'),
  ],
  alpha: DEEP_VALUE_ALPHA,
};

export const BUILTIN_PROFILES: readonly AnalysisProfile[] = [
  DEFAULT_PROFILE,
  YIELD_HUNTER_PROFILE,
  DEEP_VALUE_PROFILE,
];

/** Возвращает встроенный профиль по идентификатору. */
export function getProfile(id: string): AnalysisProfile | null {
  return BUILTIN_PROFILES.find((profile) => profile.id === id) ?? null;
}

function rule(
  stage: string,
  label: string,
  field: Extract<ScreenRule, { kind: 'compare' }>['field'],
  op: 'gte' | 'lte',
  value: number,
  nullPolicy: 'pass' | 'fail' = 'fail',
): ScreenRule {
  return { stage, label, kind: 'compare', field, op, value, nullPolicy };
}
