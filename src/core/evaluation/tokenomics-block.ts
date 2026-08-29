import { add, div, mul, round, sub } from '../money';
import type { UniverseCandidate } from '../universe/universe.types';
import { metric } from '../validate/validate.service';
import {
  DILUTION_PENALTY,
  DILUTION_RISK,
  NHY_NOISE_PCT,
  OVERHANG_ABSOLUTE_DIVISOR,
  metricOf,
} from './evaluation.constants';
import { finishBlock } from './evaluation.block';
import type { EvaluationBlock } from './evaluation.types';

const TITLE = 'Предложение: навес, разлоки и NHY';

/**
 * Оценивает давление предложения по абсолютному навесу. Состав текущей выборки
 * не влияет на покомпонентный факт; календарь уточняет базу штрафом.
 */
export function evaluateTokenomics(
  candidate: UniverseCandidate,
): EvaluationBlock {
  const overhang = candidate.overhangPct;
  const unlock = candidate.unlock12mPct;
  const nhy = candidate.netHolderYieldPct;

  const base = absoluteOverhangScore(overhang);
  const basis = base !== null ? 'absolute_overhang' : 'none';

  const penalty = penaltyOf(unlock);
  const score = base === null ? null : round(Math.max(0, sub(base, penalty)), 1);

  // Числитель календаря от DeFiLlama, знаменатель навеса от CoinGecko. Разлок
  // больше навеса значит, что источники считают эмиссию по-разному: их разность
  // не факт об активе, а расхождение адаптеров.
  const contradictory =
    unlock !== null && overhang !== null && unlock > add(overhang, 1);
  const calendarConfirmed =
    candidate.tokenomicsState === 'available' || candidate.tokenomicsState === 'known_zero';
  const hardFilterFail =
    nhy !== null && nhy < -NHY_NOISE_PCT && calendarConfirmed && !contradictory;

  const risk = dilutionRiskOf(unlock);
  const notes: string[] = [];
  if (basis === 'absolute_overhang') {
    notes.push('Навес оценён по абсолютной шкале и не зависит от состава активной выборки.');
  } else {
    notes.push('Навес неизвестен: ни circulating, ни totalSupply не дают числа. Балл не выставлен.');
  }
  if (penalty > 0) notes.push(`Штраф ${penalty} за подтверждённое разводнение ${unlock}% за 12 месяцев.`);
  if (unlock === null) notes.push('Календарь разлоков не покрыт: когда именно выйдет навес, неизвестно.');
  if (contradictory) {
    notes.push(
      `Разлок ${unlock}% выше навеса ${overhang}%: источники считают эмиссию по-разному, ` +
        'NHY из их разности хард-фильтром не является.',
    );
  }
  if (nhy !== null && nhy < 0 && !hardFilterFail && !contradictory) {
    notes.push(`NHY ${nhy}% в пределах погрешности двух источников: это шум, а не отрицательная экономика.`);
  }
  if (hardFilterFail) notes.push('Подтверждённый отрицательный NHY: разводнение съедает весь доход держателя.');

  return finishBlock('tokenomics', TITLE, {
    score,
    verdict: {
      basis,
      supplyPressurePct: overhang,
      unlock12mPct: unlock,
      netHolderYieldPct: nhy,
      dilutionRisk: risk.risk,
      dilutionRiskLabel: risk.label,
      hardFilterFail,
      sourcesDisagree: contradictory,
      tokenomicsState: candidate.tokenomicsState,
      floatPct: candidate.floatPct,
      nextUnlockAt: candidate.nextUnlockAt,
      nextUnlockCostInDailyVolumes: candidate.nextUnlockCostInDailyVolumes,
      basisExplanation:
        'Навес известен почти у всех и не зависит от чужих адаптеров, поэтому он база. ' +
        'Календарь известен у каждого десятого и потому уточняет, а не решает.',
    },
    metrics: {
      overhangPct: metricOf(candidate, 'overhangPct'),
      floatPct: metricOf(candidate, 'floatPct'),
      holderYieldPct: metricOf(candidate, 'holderYieldPct'),
      unlock12mPct: metricOf(candidate, 'unlock12mPct'),
      netHolderYieldPct: metricOf(candidate, 'netHolderYieldPct'),
      nextUnlockUsd: metric(
        candidate.nextUnlockUsd,
        candidate.tokenomicsSource,
        candidate.asOfTokenomics,
        'USD',
      ),
    },
    notes: notes.join(' '),
  });
}

/** Шкала для токена без ниши: навес 0 → 100, 100% → 50, 200% и выше → 0. */
function absoluteOverhangScore(overhang: number | null): number | null {
  if (overhang === null) return null;
  return round(
    Math.max(0, Math.min(100, sub(100, div(overhang, OVERHANG_ABSOLUTE_DIVISOR)))),
    1,
  );
}

/** Штраф применяется только к подтверждённому календарю: неизвестный не наказывает. */
function penaltyOf(unlock: number | null): number {
  if (unlock === null) return 0;
  if (unlock > DILUTION_RISK.high) return DILUTION_PENALTY.high;
  if (unlock >= DILUTION_RISK.low) return DILUTION_PENALTY.medium;
  return 0;
}

function dilutionRiskOf(unlock: number | null): { risk: string; label: string } {
  if (unlock === null) {
    return { risk: 'unknown', label: 'Календарь не покрыт: срок выхода навеса неизвестен' };
  }
  if (unlock < DILUTION_RISK.low) {
    return { risk: 'low', label: `Низкое: ${unlock}% эмиссии за 12 месяцев` };
  }
  if (unlock <= DILUTION_RISK.high) {
    return { risk: 'medium', label: `Среднее: ${unlock}% эмиссии за 12 месяцев` };
  }
  return { risk: 'high', label: `Высокое: ${unlock}% эмиссии за 12 месяцев` };
}

/** Множитель качества применяется каркасом; здесь только арифметика балла. */
export const __tokenomicsScale = { absoluteOverhangScore, penaltyOf };
