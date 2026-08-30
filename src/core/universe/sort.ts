import { UNIVERSE_SORT_ASC_DEFAULT } from './universe.types';
import type { CandidateView, UniverseSortField } from './universe.types';

export type SortOrder = 'asc' | 'desc';

/** rank, pRev, pFees — по возрастанию по умолчанию; остальные метрики — по убыванию. */
export function defaultOrderFor(field: UniverseSortField): SortOrder {
  return UNIVERSE_SORT_ASC_DEFAULT.has(field) ? 'asc' : 'desc';
}

type DirectField = Exclude<UniverseSortField, 'businessScaleScore'>;

/** businessScaleScore живёт в alpha-решении, а не на самом кандидате. */
function valueOf(item: CandidateView, field: UniverseSortField): number | null {
  if (field === 'businessScaleScore') return item.alpha?.businessScaleScore ?? null;
  return item[field as DirectField];
}

function tieBreak(left: CandidateView, right: CandidateView): number {
  if (left.rank !== right.rank) return left.rank - right.rank;
  return left.coingeckoId.localeCompare(right.coingeckoId);
}

/**
 * null всегда в конце независимо от направления: неизвестное — не худшее
 * значение. Равные значения стабилизируются по rank, затем coingeckoId.
 */
export function comparator(
  field: UniverseSortField,
  order: SortOrder,
): (left: CandidateView, right: CandidateView) => number {
  const sign = order === 'asc' ? 1 : -1;
  return (left, right) => {
    const a = valueOf(left, field);
    const b = valueOf(right, field);
    if (a === null && b === null) return tieBreak(left, right);
    if (a === null) return 1;
    if (b === null) return -1;
    if (a !== b) return a < b ? -sign : sign;
    return tieBreak(left, right);
  };
}
