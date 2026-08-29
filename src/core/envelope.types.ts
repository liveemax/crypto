import type { ActiveFilterState } from './universe/filter-state.types';

/**
 * Происхождение списка. Без него «331» не отличить ни от другого отбора, ни от
 * другого снимка, и полчаса уходит на поиск несуществующего бага.
 */
export interface ResponseContext {
  universeVersion: string;
  builtAt: string;
  activeFilters: ActiveFilterState;
  /** Время ответа, а не время источника: источники датируют каждое число сами. */
  asOf: string;
}

export interface PaginationInfo {
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface PageQuery {
  offset?: number;
  limit?: number;
}

export interface Envelope<T> {
  context: ResponseContext;
  pagination: PaginationInfo;
  items: T[];
}