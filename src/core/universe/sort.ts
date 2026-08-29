import type { CandidateView, UniverseListQuery } from './universe.types';

type SortKey = NonNullable<UniverseListQuery['sort']>;

/** rank сортируется по возрастанию, финансовые метрики — по убыванию. */
export function comparator(sort: SortKey): (left: CandidateView, right: CandidateView) => number {
  if (sort === 'rank') return (left, right) => left.rank - right.rank;
  // Неизвестное значение уходит в конец при любом направлении: null не худший, а неизвестный.
  if (sort === 'pRev') return (left, right) => (left.pRev ?? Infinity) - (right.pRev ?? Infinity);
  return (left, right) => (right[sort] ?? -Infinity) - (left[sort] ?? -Infinity);
}