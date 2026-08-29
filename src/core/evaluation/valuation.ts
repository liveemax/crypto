import { add, div, mul, round } from '../money';
import type { Metric } from '../types';
import type {
  AnalysisProfile,
  NumericField,
  ScreenRule,
  ValuationField,
} from '../universe/profile.types';
import type { UniverseCandidate } from '../universe/universe.types';
import { checkMetrics } from '../validate/validate.service';
import { metricOf } from './evaluation.constants';
import { finishBlock } from './evaluation.block';
import type { EvaluationBlock, EvaluationCheck } from './evaluation.types';

const TITLE = 'Секторная оценка цены относительно бизнеса';

interface ValuationRow {
  candidate: UniverseCandidate;
  metrics: Record<string, Metric>;
  values: Record<ValuationField, number | null>;
  percentiles: Record<ValuationField, number | null>;
  availableMetrics: ValuationField[];
  missingMetrics: ValuationField[];
  availableWeight: number;
  score: number | null;
}

/** Считает секторный valuation всей выборки после единой проверки provenance. */
export function valuationPositions(
  candidates: readonly UniverseCandidate[],
  profile: AnalysisProfile,
  screen: ScreenRule[] | null,
): Map<string, EvaluationBlock> {
  const groups = new Map<string, UniverseCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.comparisonGroup === null) continue;
    groups.set(candidate.comparisonGroup, [...(groups.get(candidate.comparisonGroup) ?? []), candidate]);
  }

  const result = new Map<string, EvaluationBlock>();
  for (const members of groups.values()) {
    const rows = positionGroup(members, profile);
    const ranked = rows.filter((row) => row.score !== null).sort(
      (left, right) => right.score! - left.score! ||
        left.candidate.coingeckoId.localeCompare(right.candidate.coingeckoId),
    );
    const ranks = new Map(ranked.map((row, index) => [row.candidate.coingeckoId, index + 1]));
    for (const row of rows) {
      result.set(row.candidate.coingeckoId, blockOf(row, profile, screen, ranks.get(row.candidate.coingeckoId) ?? null));
    }
  }

  for (const candidate of candidates) {
    if (!result.has(candidate.coingeckoId)) {
      const row = emptyRow(candidate, profile);
      result.set(candidate.coingeckoId, blockOf(row, profile, screen, null));
    }
  }
  return result;
}

function positionGroup(members: UniverseCandidate[], profile: AnalysisProfile): ValuationRow[] {
  const verified = new Map(members.map((candidate) => [candidate.coingeckoId, verifiedRow(candidate, profile)]));
  return members.map((candidate) => {
    const base = verified.get(candidate.coingeckoId)!;
    const percentiles = {} as Record<ValuationField, number | null>;
    for (const axis of profile.valuation.rankBy) {
      const values = members.flatMap((member) => {
        const value = verified.get(member.coingeckoId)!.values[axis.field];
        return value === null ? [] : [value];
      });
      const value = base.values[axis.field];
      percentiles[axis.field] = value === null
        ? null
        : percentileOf(value, values, axis.direction, profile.valuation.minRankedValues);
    }
    const availableMetrics = profile.valuation.rankBy
      .filter((axis) => percentiles[axis.field] !== null).map((axis) => axis.field);
    const missingMetrics = profile.valuation.rankBy
      .filter((axis) => percentiles[axis.field] === null).map((axis) => axis.field);
    const availableWeight = round(profile.valuation.rankBy
      .filter((axis) => availableMetrics.includes(axis.field))
      .reduce((sum, axis) => add(sum, axis.weight), 0), 2);
    const hasPrimary = availableMetrics.includes('pRev') || availableMetrics.includes('fdvRev');
    const gate = hasPrimary && availableMetrics.length >= profile.valuation.minScoreMetrics &&
      availableWeight >= profile.valuation.minAvailableWeight;
    const weighted = profile.valuation.rankBy.reduce((sum, axis) => {
      const percentile = percentiles[axis.field];
      return percentile === null ? sum : add(sum, mul(percentile, axis.weight));
    }, 0);
    return { ...base, percentiles, availableMetrics, missingMetrics, availableWeight,
      score: gate ? round(div(weighted, availableWeight), 1) : null };
  });
}

function verifiedRow(candidate: UniverseCandidate, profile: AnalysisProfile): Omit<ValuationRow, 'percentiles' | 'availableMetrics' | 'missingMetrics' | 'availableWeight' | 'score'> {
  const metrics = valuationMetrics(candidate);
  const checked = checkMetrics(metrics);
  const stale = new Set(checked.validator.stale);
  const values = {} as Record<ValuationField, number | null>;
  for (const axis of profile.valuation.rankBy) {
    const value = checked.metrics[axis.field]?.value;
    values[axis.field] = typeof value === 'number' && !stale.has(axis.field) && candidate.sourceHealthy
      ? value
      : null;
  }
  return { candidate, metrics, values };
}

function emptyRow(candidate: UniverseCandidate, profile: AnalysisProfile): ValuationRow {
  const base = verifiedRow(candidate, profile);
  const fields = profile.valuation.rankBy.map((axis) => axis.field);
  return { ...base, percentiles: Object.fromEntries(fields.map((field) => [field, null])) as Record<ValuationField, null>, availableMetrics: [], missingMetrics: fields, availableWeight: 0, score: null };
}

function blockOf(row: ValuationRow, profile: AnalysisProfile, screen: ScreenRule[] | null, valuationRank: number | null): EvaluationBlock {
  const checks = checksOf(row.candidate, profile, screen);
  const failed = checks.filter((check) => !check.passed);
  const missing = [...new Set([...row.missingMetrics, ...(row.candidate.comparisonGroup === null ? ['comparisonGroup'] : [])])];
  return finishBlock('valuation', TITLE, {
    score: row.score,
    verdict: {
      passed: failed.length === 0,
      failedChecks: failed.flatMap((check) => check.reason === null ? [] : [check.reason]),
      checks,
      availableMetrics: row.availableMetrics,
      missingMetrics: row.missingMetrics,
      availableWeight: row.availableWeight,
      valuationRank,
      percentiles: row.percentiles,
      formulaVersion: profile.valuation.formulaVersion,
      revenueBasis: row.candidate.revenueBasis,
      revenueState: row.candidate.revenueState,
    },
    metrics: row.metrics,
    missing,
    adjustScoreForQuality: false,
    notes: row.score === null
      ? 'Балл не выставлен: нужен основной мультипликатор, минимум две оси и доступный вес не ниже 0.60.'
      : `Секторный valuation: место ${valuationRank} среди ${row.candidate.comparisonGroup}. Абсолютные пороги показаны отдельно и в балл не входят.`,
  });
}

function valuationMetrics(candidate: UniverseCandidate): Record<string, Metric> {
  return Object.fromEntries([
    'mcapCalcUsd', 'fdvUsd', 'tvlUsd', 'fees12mUsd', 'revenue12mUsd',
    'holdersRevenue12mUsd', 'pRev', 'pFees', 'fdvRev', 'holderYieldPct',
    'revenuePerTvlPct',
  ].map((field) => [field, metricOf(candidate, field as NumericField)]));
}

function percentileOf(value: number, values: number[], direction: 'higher_better' | 'lower_better', minimum: number): number | null {
  if (values.length < minimum) return null;
  const worse = values.filter((other) => direction === 'higher_better' ? other < value : other > value).length;
  const ties = values.filter((other) => other === value).length - 1;
  return round(div(mul(add(worse, mul(ties, 0.5)), 100), values.length - 1), 2);
}

function checksOf(candidate: UniverseCandidate, profile: AnalysisProfile, screen: ScreenRule[] | null): EvaluationCheck[] {
  const limits = profile.thresholds;
  return [
    check('hasRevenue', candidate.revenue12mUsd !== null, appliedByKnown(screen, 'revenue12mUsd'), 'Выручка за 12 месяцев не измерена'),
    check('revenueAboveMin', candidate.revenue12mUsd !== null && candidate.revenue12mUsd >= limits.minAnnualRevenueUsd, appliedBy(screen, 'revenue12mUsd', 'gte', limits.minAnnualRevenueUsd, candidate.revenue12mUsd), `Выручка ниже ${limits.minAnnualRevenueUsd} USD`),
    check('mcapAboveMin', candidate.mcapCalcUsd !== null && candidate.mcapCalcUsd >= limits.minMcapUsd, appliedBy(screen, 'mcapCalcUsd', 'gte', limits.minMcapUsd, candidate.mcapCalcUsd), `Капитализация ниже ${limits.minMcapUsd} USD`),
    check('pRevSane', candidate.pRev !== null && candidate.pRev <= limits.maxPRev, appliedBy(screen, 'pRev', 'lte', limits.maxPRev, candidate.pRev), candidate.pRev === null ? 'P/Rev неизвестен' : `P/Rev выше ${limits.maxPRev}`),
  ];
}
function check(id: string, passed: boolean, appliedByValue: EvaluationCheck['appliedBy'], reason: string): EvaluationCheck { return { id, passed, appliedBy: appliedByValue, reason: passed ? null : reason }; }
function appliedBy(screen: ScreenRule[] | null, field: NumericField, op: 'gte' | 'lte', value: number, actual: number | null): EvaluationCheck['appliedBy'] {
  const rule = screen?.find((item) => item.kind === 'compare' && item.field === field && item.op === op && (op === 'gte' ? item.value >= value : item.value <= value));
  return rule?.kind === 'compare' && (rule.nullPolicy === 'fail' || actual !== null) ? 'screen' : 'evaluation';
}
function appliedByKnown(screen: ScreenRule[] | null, field: NumericField): EvaluationCheck['appliedBy'] { return screen?.some((item) => item.kind === 'compare' && item.field === field && item.nullPolicy === 'fail') ? 'screen' : 'evaluation'; }
