import { add, div, mul, pctOf, round, sub } from '../money';
import { EVALUATION_COMPONENTS, type EvaluationWeights } from '../evaluation/evaluation.types';
import type { AnalysisProfile } from '../universe/profile.types';
import { applyPenalty, composite } from './composite';
import { tierOf } from './ranking.candidate';
import {
  SENSITIVITY_MIN_CANDIDATES_FOR_VERDICT,
  SENSITIVITY_STABLE_MAX_SHARE_PCT,
  SENSITIVITY_WEIGHT_MULTIPLIERS,
} from './ranking.constants';
import type { RankedCandidate, RankTier } from './ranking.types';
import type {
  SensitivityCandidateResult,
  SensitivityInterpretation,
  SensitivityScenario,
  SensitivitySummary,
} from './sensitivity.types';

const TIER_ORDER: RankTier[] = ['A', 'B', 'C', 'watchlist'];

/**
 * 25 нормированных наборов весов: сетка множителей tokenomics×valuation,
 * sectorPosition всегда ×1.00. sectorPosition считается остатком до 1, а не
 * отдельным делением — иначе округление трёх независимых долей не обязано
 * дать сумму ровно 1.
 */
export function buildScenarios(weights: EvaluationWeights): SensitivityScenario[] {
  const scenarios: SensitivityScenario[] = [];
  for (const tokenomicsMultiplier of SENSITIVITY_WEIGHT_MULTIPLIERS) {
    for (const valuationMultiplier of SENSITIVITY_WEIGHT_MULTIPLIERS) {
      const rawTokenomics = mul(weights.tokenomics, tokenomicsMultiplier);
      const rawValuation = mul(weights.valuation, valuationMultiplier);
      const total = add(add(rawTokenomics, rawValuation), weights.sectorPosition);

      const tokenomics = round(div(rawTokenomics, total), 6);
      const valuation = round(div(rawValuation, total), 6);
      const sectorPosition = round(sub(sub(1, tokenomics), valuation), 6);

      scenarios.push({
        tokenomicsMultiplier,
        valuationMultiplier,
        weights: { tokenomics, valuation, sectorPosition },
      });
    }
  }
  return scenarios;
}

interface ScenarioOutcome {
  composite: number | null;
  tier: RankTier;
}

/**
 * Композит и тир одного кандидата под одним весовым сценарием. hardFilters,
 * flagPenalty и dataQuality остаются baseline: sensitivity меняет только веса,
 * а не пересчитывает данные кандидата заново.
 */
function outcomeOf(candidate: RankedCandidate, scenario: SensitivityScenario, profile: AnalysisProfile): ScenarioOutcome {
  const components = EVALUATION_COMPONENTS.map((name) => ({
    component: name,
    score: candidate.evaluation[name].score,
    weight: scenario.weights[name],
    dataQuality: candidate.evaluation[name].dataQuality,
  }));
  const gate = composite(components);
  const final = applyPenalty(gate.composite, candidate.evaluation.flagPenalty);
  const tier = tierOf(candidate.hardFilters, final, candidate.dataQuality, profile.tierCuts);
  return { composite: final, tier };
}

/** Реакция одного кандидата на все 25 сценариев: baseline, разброс и число смен тира. */
export function sensitivityForCandidate(
  candidate: RankedCandidate,
  scenarios: SensitivityScenario[],
  profile: AnalysisProfile,
): SensitivityCandidateResult {
  const outcomes = scenarios.map((scenario) => outcomeOf(candidate, scenario, profile));
  return candidateResultOf(candidate, outcomes);
}

function candidateResultOf(candidate: RankedCandidate, outcomes: ScenarioOutcome[]): SensitivityCandidateResult {
  const composites = outcomes
    .map((item) => item.composite)
    .filter((value): value is number => value !== null);
  const tiers = outcomes.map((item) => item.tier);

  return {
    coingeckoId: candidate.evaluation.coingeckoId,
    ticker: candidate.evaluation.ticker,
    name: candidate.evaluation.name,
    baselineTier: candidate.rankTier,
    baselineComposite: candidate.composite,
    minComposite: composites.length > 0 ? Math.min(...composites) : null,
    maxComposite: composites.length > 0 ? Math.max(...composites) : null,
    tierChanges: tiers.filter((tier) => tier !== candidate.rankTier).length,
    tiersReached: TIER_ORDER.filter((tier) => tiers.includes(tier)),
  };
}

function emptyMatrix(): Record<RankTier, Record<RankTier, number>> {
  const matrix = {} as Record<RankTier, Record<RankTier, number>>;
  for (const from of TIER_ORDER) {
    matrix[from] = {} as Record<RankTier, number>;
    for (const to of TIER_ORDER) matrix[from][to] = 0;
  }
  return matrix;
}

/**
 * Полный sensitivity-отчёт по всем кандидатам сохранённого ranking run: список
 * результатов страницами собирает вызывающий сервис, здесь — сами числа и
 * summary с transition matrix и интерпретацией.
 */
export function sensitivityReportOf(
  candidates: RankedCandidate[],
  scenarios: SensitivityScenario[],
  profile: AnalysisProfile,
): { results: SensitivityCandidateResult[]; summary: SensitivitySummary } {
  const matrix = emptyMatrix();
  const results: SensitivityCandidateResult[] = [];

  for (const candidate of candidates) {
    const outcomes = scenarios.map((scenario) => outcomeOf(candidate, scenario, profile));
    for (const outcome of outcomes) matrix[candidate.rankTier][outcome.tier] += 1;
    results.push(candidateResultOf(candidate, outcomes));
  }

  const withComposite = results.filter((item) => item.baselineComposite !== null);
  const changed = withComposite.filter((item) => item.tierChanges > 0);
  const tierChangedSharePct =
    withComposite.length > 0 ? round(pctOf(changed.length, withComposite.length), 1) : 0;

  const interpretation: SensitivityInterpretation =
    withComposite.length < SENSITIVITY_MIN_CANDIDATES_FOR_VERDICT
      ? 'insufficient_data'
      : tierChangedSharePct > SENSITIVITY_STABLE_MAX_SHARE_PCT
        ? 'sensitive'
        : 'stable';

  return {
    results,
    summary: {
      scenarioCount: scenarios.length,
      candidatesWithComposite: withComposite.length,
      candidatesTierChanged: changed.length,
      tierChangedSharePct,
      interpretation,
      transitionMatrix: matrix,
    },
  };
}
