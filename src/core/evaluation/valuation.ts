import { div, mul, round, sub } from '../money';
import type { AnalysisProfile, NumericField, ScreenRule } from '../universe/profile.types';
import type { UniverseCandidate } from '../universe/universe.types';
import { metric } from '../validate/validate.service';
import { financialAsOf, metricOf } from './evaluation.constants';
import { finishBlock } from './evaluation.block';
import type { EvaluationBlock, EvaluationCheck } from './evaluation.types';

const TITLE = 'Дешевизна и базовые пороги';

/** Считает дешевизну кандидата по порогам профиля. Ни одного сетевого запроса. */
export function evaluateValuation(
  candidate: UniverseCandidate,
  profile: AnalysisProfile,
  screen: ScreenRule[] | null,
): EvaluationBlock {
  const limits = profile.thresholds;

  const checks: EvaluationCheck[] = [
    {
      id: 'hasRevenue',
      passed: candidate.revenue12mUsd !== null,
      appliedBy: appliedByKnown(screen, 'revenue12mUsd'),
      reason: candidate.revenue12mUsd === null ? 'Выручка за 12 месяцев не измерена' : null,
    },
    {
      id: 'revenueAboveMin',
      passed:
        candidate.revenue12mUsd !== null &&
        candidate.revenue12mUsd >= limits.minAnnualRevenueUsd,
      appliedBy: appliedBy(
        screen,
        'revenue12mUsd',
        'gte',
        limits.minAnnualRevenueUsd,
        candidate.revenue12mUsd,
      ),
      reason:
        candidate.revenue12mUsd !== null &&
        candidate.revenue12mUsd >= limits.minAnnualRevenueUsd
          ? null
          : `Выручка ${fmt(candidate.revenue12mUsd)} при пороге ${fmt(limits.minAnnualRevenueUsd)} USD`,
    },
    {
      id: 'mcapAboveMin',
      passed: candidate.mcapCalcUsd !== null && candidate.mcapCalcUsd >= limits.minMcapUsd,
      appliedBy: appliedBy(
        screen,
        'mcapCalcUsd',
        'gte',
        limits.minMcapUsd,
        candidate.mcapCalcUsd,
      ),
      reason:
        candidate.mcapCalcUsd !== null && candidate.mcapCalcUsd >= limits.minMcapUsd
          ? null
          : `Капитализация ${fmt(candidate.mcapCalcUsd)} при пороге ${fmt(limits.minMcapUsd)} USD`,
    },
    {
      id: 'pRevSane',
      passed: candidate.pRev !== null && candidate.pRev <= limits.maxPRev,
      appliedBy: appliedBy(screen, 'pRev', 'lte', limits.maxPRev, candidate.pRev),
      reason:
        candidate.pRev !== null && candidate.pRev <= limits.maxPRev
          ? null
          : candidate.pRev === null
            ? 'P/Rev неизвестен: нет выручки'
            : `P/Rev ${candidate.pRev} при пороге ${limits.maxPRev}`,
    },
  ];

  const failed = checks.filter((item) => !item.passed);

  // Балл считается из pRev, а не из результата проверок: не пройденный порог и
  // отсутствие данных — разные вещи, и вторая не должна выглядеть как первая.
  const score =
    candidate.revenue12mUsd === null || candidate.pRev === null
      ? null
      : round(
          Math.max(0, Math.min(100, sub(100, mul(100, div(candidate.pRev, limits.maxPRev))))),
          1,
        );

  return finishBlock('valuation', TITLE, {
    score,
    verdict: {
      passed: failed.length === 0,
      failedChecks: failed.map((item) => item.reason).filter((item): item is string => item !== null),
      checks,
      maxPRev: limits.maxPRev,
      revenueBasis: candidate.revenueBasis,
      revenueState: candidate.revenueState,
      takeRatePct: candidate.takeRatePct,
      takeRateExplanation:
        'Доля пользовательских комиссий, остающаяся протоколу. Протокол, собирающий ' +
        '500 млн комиссий и оставляющий себе 2%, — это бизнес поставщиков капитала, ' +
        'а не токена.',
    },
    metrics: {
      mcapCalcUsd: metricOf(candidate, 'mcapCalcUsd'),
      fdvUsd: metricOf(candidate, 'fdvUsd'),
      tvlUsd: metricOf(candidate, 'tvlUsd'),
      fees12mUsd: metricOf(candidate, 'fees12mUsd'),
      revenue12mUsd: metricOf(candidate, 'revenue12mUsd'),
      pRev: metricOf(candidate, 'pRev'),
      pFees: metricOf(candidate, 'pFees'),
      takeRatePct: metricOf(candidate, 'takeRatePct'),
      fdvRev: metric(candidate.fdvRev, candidate.revenueSource, financialAsOf(candidate), 'x'),
    },
    notes:
      score === null
        ? 'Балл не выставлен: без выручки или P/Rev дешевизны не существует. ' +
          'Отсутствие данных и дорогая оценка — разные вещи.'
        : failed.length === 0
          ? 'Все пороги профиля пройдены.'
          : `Не пройдено проверок: ${failed.length}. Это не отсев — оценка состава не меняет.`,
  });
}

/**
 * Кем проверка уже применена. Правило одно: в активном screen есть сравнение того
 * же поля и оператора не мягче порога, и оно реально сработало на этом кандидате.
 * nullPolicy: 'pass' с неизвестным значением означает, что screen его пропустил.
 */
function appliedBy(
  screen: ScreenRule[] | null,
  field: NumericField,
  op: 'gte' | 'lte',
  value: number,
  actual: number | null,
): EvaluationCheck['appliedBy'] {
  if (screen === null) return 'evaluation';
  const rule = screen.find(
    (item) =>
      item.kind === 'compare' &&
      item.field === field &&
      item.op === op &&
      (op === 'gte' ? item.value >= value : item.value <= value),
  );
  if (rule === undefined || rule.kind !== 'compare') return 'evaluation';
  if (rule.nullPolicy === 'fail') return 'screen';
  return actual !== null ? 'screen' : 'evaluation';
}

/** Проверку «число вообще известно» применяет только правило с nullPolicy: 'fail'. */
function appliedByKnown(
  screen: ScreenRule[] | null,
  field: NumericField,
): EvaluationCheck['appliedBy'] {
  if (screen === null) return 'evaluation';
  const strict = screen.some(
    (item) => item.kind === 'compare' && item.field === field && item.nullPolicy === 'fail',
  );
  return strict ? 'screen' : 'evaluation';
}

function fmt(value: number | null): string {
  return value === null ? '—' : Math.round(value).toLocaleString('ru-RU');
}