import { round, sub } from '../money';
import type { ManualIncentiveOverrideRecord } from '../manual/manual.types';
import type { UniverseCandidate } from '../universe/universe.types';
import { metric } from '../validate/validate.service';
import { metricOf } from './evaluation.constants';
import type { RiskFlag } from './evaluation.types';

/** Выше — риск манипуляции ценой: спекулятивный оборот на порядок больше капитализации. */
export const HIGH_TURNOVER_PCT = 50;
/** Ниже — торгов практически нет, выйти из позиции без просадки цены сложно. */
export const ILLIQUID_TURNOVER_PCT = 0.5;
/** Штраф одного сработавшего флага. */
export const RISK_FLAG_PENALTY = 10;
/** Потолок суммарного штрафа: число сработавших флагов его не поднимает. */
export const RISK_FLAG_PENALTY_CAP = 20;

export interface RiskAssessment {
  flags: RiskFlag[];
  penalty: number;
  missing: string[];
}

/**
 * Считает риск-флаги одного кандидата: ликвидность по обороту и экономика
 * после ручных стимулов. Ни сети, ни модели — только уже загруженные факты.
 */
export function riskFlagsOf(
  candidate: UniverseCandidate,
  incentiveOverride: ManualIncentiveOverrideRecord | null,
): RiskAssessment {
  const missing: string[] = [];
  const flags: RiskFlag[] = [];

  const turnoverFlag = turnoverFlagOf(candidate, missing);
  if (turnoverFlag) flags.push(turnoverFlag);

  const incentiveFlag = incentiveFlagOf(candidate, incentiveOverride, missing);
  if (incentiveFlag) flags.push(incentiveFlag);

  return { flags, penalty: capPenalty(flags), missing: missing.sort() };
}

/** Сумма штрафов сработавших флагов, зажатая потолком независимо от их числа. */
export function capPenalty(flags: RiskFlag[]): number {
  const total = flags.reduce((sum, flag) => sum + flag.penalty, 0);
  return Math.min(total, RISK_FLAG_PENALTY_CAP);
}

/** Неизвестный оборот не создаёт флага: молчание — не доказательство ликвидности. */
function turnoverFlagOf(candidate: UniverseCandidate, missing: string[]): RiskFlag | null {
  const turnover = candidate.turnoverPct;
  if (turnover === null) {
    missing.push('turnoverPct');
    return null;
  }
  if (turnover > HIGH_TURNOVER_PCT) {
    return {
      id: 'high_turnover',
      label:
        `Оборот ${turnover}% от капитализации за сутки: экстремально высокая ` +
        'торговая активность, возможна манипуляция ценой',
      value: turnover,
      penalty: RISK_FLAG_PENALTY,
      metric: metricOf(candidate, 'turnoverPct'),
    };
  }
  if (turnover < ILLIQUID_TURNOVER_PCT) {
    return {
      id: 'illiquid',
      label: `Оборот ${turnover}% от капитализации за сутки: торгов почти нет, выйти из позиции сложно`,
      value: turnover,
      penalty: RISK_FLAG_PENALTY,
      metric: metricOf(candidate, 'turnoverPct'),
    };
  }
  return null;
}

/**
 * Отрицательная выручка после вычета стимулов держателям. Без подтверждённого
 * override стимулы неизвестны, а не равны нулю — флага и подстановки нет.
 */
function incentiveFlagOf(
  candidate: UniverseCandidate,
  override: ManualIncentiveOverrideRecord | null,
  missing: string[],
): RiskFlag | null {
  if (override === null) {
    missing.push('incentives12mUsd');
    return null;
  }
  const revenue = candidate.revenue12mUsd;
  if (revenue === null) {
    missing.push('revenue12mUsd');
    return null;
  }

  const adjusted = round(sub(revenue, override.incentives12mUsd), 2);
  if (adjusted >= 0) return null;

  return {
    id: 'negative_after_incentives',
    label: `Выручка за вычетом стимулов держателям отрицательна: ${adjusted} USD за 12 месяцев`,
    value: adjusted,
    penalty: RISK_FLAG_PENALTY,
    metric: metric(override.incentives12mUsd, override.sourceUrl, override.asOf, 'USD'),
  };
}
