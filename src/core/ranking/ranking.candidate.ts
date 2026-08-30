import { EVALUATION_COMPONENTS } from '../evaluation/evaluation.types';
import type { CandidateEvaluation } from '../evaluation/evaluation.types';
import type { AnalysisProfile } from '../universe/profile.types';
import { applyPenalty, composite, type CompositeResult } from './composite';
import { RANK_TIER_A_MIN_DATA_QUALITY } from './ranking.constants';
import type { HardFilterReason, RankedCandidate, RankTier } from './ranking.types';

/**
 * Композит одного кандидата плюс тир. Чистая функция: ни сети, ни хранилища —
 * их зовёт только RankingService, эту же логику проверяют unit-тесты напрямую.
 */
export function rankCandidate(candidate: CandidateEvaluation, profile: AnalysisProfile): RankedCandidate {
  const components = EVALUATION_COMPONENTS.map((name) => ({
    component: name,
    score: candidate[name].score,
    weight: profile.weights[name],
    dataQuality: candidate[name].dataQuality,
  }));
  const gate = composite(components);
  const final = applyPenalty(gate.composite, candidate.flagPenalty);
  const hardFilters = hardFiltersOf(candidate);
  const rankTier = tierOf(hardFilters, final, gate.dataQuality, profile.tierCuts);

  return {
    evaluation: candidate,
    rankTier,
    compositeBase: gate.composite,
    composite: final,
    componentsUsed: gate.componentsUsed,
    weightSum: gate.weightSum,
    compositeReason: gate.reason,
    dataQuality: gate.dataQuality,
    hardFilters,
    whatWouldChangeThis: whatWouldChangeThisOf(candidate, gate, hardFilters),
  };
}

/**
 * Тиры шага 15.1: хард-фильтр обязателен раньше числа, а тир A требует не
 * только composite профиля, но и отдельный порог качества данных. Экспортная —
 * sensitivity шага 16.2 пересчитывает тир по тем же правилам, но с фиксированным
 * dataQuality baseline и весами сценария, а не второй копией этой логики.
 */
export function tierOf(
  hardFilters: HardFilterReason[],
  final: number | null,
  dataQuality: number,
  cuts: AnalysisProfile['tierCuts'],
): RankTier {
  if (hardFilters.length > 0) return 'watchlist';
  if (final === null || dataQuality < cuts.minDataQuality) return 'C';
  if (final >= cuts.a && dataQuality >= RANK_TIER_A_MIN_DATA_QUALITY) return 'A';
  if (final >= cuts.b) return 'B';
  return 'C';
}

/** Ровно два хард-фильтра: провал абсолютных проверок valuation и подтверждённый отрицательный NHY. */
function hardFiltersOf(candidate: CandidateEvaluation): HardFilterReason[] {
  const reasons: HardFilterReason[] = [];
  if (candidate.valuation.verdict.passed === false) {
    const failed = candidate.valuation.verdict.failedChecks;
    reasons.push({
      id: 'valuation_failed',
      reason:
        Array.isArray(failed) && failed.length > 0
          ? failed.join('; ')
          : 'Провалена одна из абсолютных проверок valuation.',
    });
  }
  if (candidate.tokenomics.verdict.hardFilterFail === true) {
    reasons.push({
      id: 'tokenomics_hard_filter',
      reason: 'Подтверждённый отрицательный NHY: разводнение съедает весь доход держателя.',
    });
  }
  return reasons;
}

function whatWouldChangeThisOf(
  candidate: CandidateEvaluation,
  gate: CompositeResult,
  hardFilters: HardFilterReason[],
): string[] {
  const items = hardFilters.map((item) => item.reason);
  if (gate.reason !== null) items.push(gate.reason);

  const missing = new Set<string>();
  for (const name of EVALUATION_COMPONENTS) {
    for (const field of candidate[name].missing) missing.add(field);
  }
  if (missing.size > 0) items.push(`Не хватает данных: ${[...missing].sort().join(', ')}.`);
  return items;
}
