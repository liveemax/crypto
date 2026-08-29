import { round } from '../money';
import { EVALUATION_COMPONENTS, type EvaluationComponentName } from '../evaluation/evaluation.types';
import type { RankedCandidate, RankingSummaryRow } from './ranking.types';

/**
 * Лёгкая строка кандидата для view=summary: metrics/percentiles/peers/provenance
 * остаются только у полной evaluation-карточки в view=full, а не дублируются здесь.
 */
export function rankingSummaryRow(candidate: RankedCandidate): RankingSummaryRow {
  const scores = {} as Record<EvaluationComponentName, number | null>;
  const dataQuality = {} as Record<EvaluationComponentName, number>;
  const missing = new Set<string>();
  for (const name of EVALUATION_COMPONENTS) {
    const block = candidate.evaluation[name];
    scores[name] = block.score;
    dataQuality[name] = round(block.dataQuality, 3);
    for (const field of block.missing) missing.add(field);
  }

  return {
    coingeckoId: candidate.evaluation.coingeckoId,
    ticker: candidate.evaluation.ticker,
    name: candidate.evaluation.name,
    comparisonGroup: candidate.evaluation.comparisonGroup,
    dataTier: candidate.evaluation.dataTier,
    rankTier: candidate.rankTier,
    scores,
    dataQuality,
    composite: {
      compositeBase: candidate.compositeBase,
      composite: candidate.composite,
      componentsUsed: candidate.componentsUsed,
      weightSum: candidate.weightSum,
      compositeReason: candidate.compositeReason,
      dataQuality: candidate.dataQuality,
    },
    hardFilters: candidate.hardFilters,
    missing: [...missing].sort(),
    riskFlags: candidate.evaluation.riskFlags.map((flag) => ({
      id: flag.id,
      label: flag.label,
      penalty: flag.penalty,
    })),
    flagPenalty: candidate.evaluation.flagPenalty,
    notEvaluated: candidate.evaluation.notEvaluated,
  };
}
