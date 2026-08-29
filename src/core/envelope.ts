import type { PageQuery, PaginationInfo } from './envelope.types';

/** Скромный дефолт: полная выдача — это мегабайты JSON, которые Swagger кладёт в DOM. */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/** Режет список страницей и всегда называет полный total: обрезанная очередь выглядит короткой. */
export function paginate<T>(
  items: readonly T[],
  query: PageQuery = {},
  defaultLimit: number = DEFAULT_LIMIT,
  maxLimit: number = MAX_LIMIT,
): { page: T[]; pagination: PaginationInfo } {
  const requested = Math.trunc(query.limit ?? defaultLimit);
  const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : defaultLimit, 1), maxLimit);
  const from = Math.trunc(query.offset ?? 0);
  const offset = Math.max(Number.isFinite(from) ? from : 0, 0);
  const page = items.slice(offset, offset + limit);
  return {
    page,
    pagination: { offset, limit, total: items.length, hasMore: offset + page.length < items.length },
  };
}