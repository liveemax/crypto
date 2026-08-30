import { RANK_TIERS } from './ranking.types';
import type { RankedCandidate, RankingSortField, RankTier } from './ranking.types';

export type RankingSortOrder = 'asc' | 'desc';

const TIER_INDEX: Record<RankTier, number> = Object.fromEntries(
  RANK_TIERS.map((tier, index) => [tier, index]),
) as Record<RankTier, number>;

/** tier и name — по возрастанию по умолчанию (A→B→C→watchlist, A→Z); баллы — по убыванию. */
export function defaultRankingOrderFor(field: RankingSortField): RankingSortOrder {
  return field === 'tier' || field === 'name' ? 'asc' : 'desc';
}

function scoreOf(candidate: RankedCandidate, field: RankingSortField): number | null {
  switch (field) {
    case 'composite':
      return candidate.composite;
    case 'valuation':
      return candidate.evaluation.valuation.score;
    case 'tokenomics':
      return candidate.evaluation.tokenomics.score;
    case 'sectorPosition':
      return candidate.evaluation.sectorPosition.score;
    case 'dataQuality':
      return candidate.dataQuality;
    default:
      return null;
  }
}

/** Детерминированная ничья: одна и та же пара всегда в одном порядке. */
function tieBreak(left: RankedCandidate, right: RankedCandidate): number {
  return left.evaluation.coingeckoId.localeCompare(right.evaluation.coingeckoId);
}

function compareCompositeDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/**
 * order разворачивает только порядок тиров; composite desc внутри тира — условие
 * ТЗ 1.3, а не мнение направления сортировки.
 */
function tierComparator(order: RankingSortOrder): (left: RankedCandidate, right: RankedCandidate) => number {
  const sign = order === 'asc' ? 1 : -1;
  return (left, right) => {
    const a = TIER_INDEX[left.rankTier];
    const b = TIER_INDEX[right.rankTier];
    if (a !== b) return sign * (a - b);
    const composite = compareCompositeDesc(left.composite, right.composite);
    if (composite !== 0) return composite;
    return tieBreak(left, right);
  };
}

function nameComparator(order: RankingSortOrder): (left: RankedCandidate, right: RankedCandidate) => number {
  const sign = order === 'asc' ? 1 : -1;
  return (left, right) => {
    const cmp = left.evaluation.name.localeCompare(right.evaluation.name);
    return cmp !== 0 ? sign * cmp : tieBreak(left, right);
  };
}

/** null всегда в конце независимо от направления: неизвестный балл — не худший. */
function scoreComparator(
  field: RankingSortField,
  order: RankingSortOrder,
): (left: RankedCandidate, right: RankedCandidate) => number {
  const sign = order === 'asc' ? 1 : -1;
  return (left, right) => {
    const a = scoreOf(left, field);
    const b = scoreOf(right, field);
    if (a === null && b === null) return tieBreak(left, right);
    if (a === null) return 1;
    if (b === null) return -1;
    if (a !== b) return a < b ? -sign : sign;
    return tieBreak(left, right);
  };
}

export function rankingComparator(
  field: RankingSortField,
  order: RankingSortOrder,
): (left: RankedCandidate, right: RankedCandidate) => number {
  if (field === 'tier') return tierComparator(order);
  if (field === 'name') return nameComparator(order);
  return scoreComparator(field, order);
}
