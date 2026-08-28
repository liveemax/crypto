import { setTimeout as delay } from 'node:timers/promises';

export interface FetchResult<T = unknown> {
  /** Запрос завершился кодом 2xx и тело разобрано как JSON. */
  ok: boolean;
  /** HTTP-статус; null означает сетевой сбой или таймаут. */
  status: number | null;
  data: T | null;
  error: string | null;
  /** Сколько источник просит подождать: заголовок Retry-After, если он был. */
  retryAfterMs: number | null;
}

export interface FetchOptions {
  attempts?: number;
  timeoutMs?: number;
  /** Минимальная пауза между запросами к одному хосту. */
  minGapMs?: number;
  headers?: Record<string, string>;
}

/** Паузы по хостам: CoinGecko на бесплатном тарифе режет жёстко, DeFiLlama мягко. */
const HOST_GAP_MS: Record<string, number> = {
  'api.coingecko.com': process.env.COINGECKO_API_KEY ? 2_200 : 4_500,
  'api.llama.fi': 400,
  // Статический CDN без лимита. Очередь на хост сохраняется, пауза не нужна:
  // 370 документов эмиссий с паузой в секунду превращают 15 секунд в шесть минут.
  'defillama-datasets.llama.fi': 0,
};
const lastCallAt = new Map<string, number>();
const hostQueue = new Map<string, Promise<unknown>>();

/**
 * Выполняет HTTP-запрос с очередью на хост, таймаутом и повторами.
 * Статус ответа не теряется: вызывающий отличает 404 от 429 и от сетевого сбоя.
 */
export async function fetchJson<T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<FetchResult<T>> {
  const attempts = options.attempts ?? 5;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const host = hostOf(url);
  const minGapMs = options.minGapMs ?? HOST_GAP_MS[host] ?? 1_000;

  let last: FetchResult<T> = {
    ok: false,
    status: null,
    data: null,
    error: 'Запрос не выполнялся',
    retryAfterMs: null,
  };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await withHostSlot(host, minGapMs, () =>
      requestOnce<T>(url, timeoutMs, options.headers),
    );
    if (last.ok) return last;

    const retriable =
      last.status === null || last.status === 429 || last.status >= 500;
    if (!retriable || attempt === attempts - 1) return last;

    // Источник сам называет паузу. Своя формула — только когда он молчит.
    const backoff = (last.status === 429 ? 4 : 1) * 2 ** attempt * minGapMs;
    await delay(Math.min(Math.max(last.retryAfterMs ?? backoff, backoff), 120_000));
  }

  return last;
}

/**
 * То же, что fetchJson, плюс время источника из заголовка last-modified.
 * Датасет эмиссий не содержит своей даты в теле, а метрика без asOf обнуляется
 * валидатором. Отдельная функция, потому что requestOnce заголовки наружу не
 * отдаёт; свести их в одну — отдельная правка requestOnce.
 */
export async function fetchJsonWithDate<T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<FetchResult<T> & { sourceDate: string | null }> {
  const attempts = options.attempts ?? 5;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const host = hostOf(url);
  const minGapMs = options.minGapMs ?? HOST_GAP_MS[host] ?? 1_000;

  let last: FetchResult<T> & { sourceDate: string | null } = {
    ok: false,
    status: null,
    data: null,
    error: 'Запрос не выполнялся',
    retryAfterMs: null,
    sourceDate: null,
  };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await withHostSlot(host, minGapMs, async () => {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { accept: 'application/json', ...(options.headers ?? {}) },
        });
        const text = await response.text();
        const sourceDate = response.headers.get('last-modified');
        const retryAfter = Number(response.headers.get('retry-after'));
        const retryAfterMs =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : null;
        if (!response.ok) {
          // Статус не теряется: неверный слаг иначе неотличим от 429.
          return {
            ok: false,
            status: response.status,
            data: null,
            error: `HTTP ${response.status}: ${text.slice(0, 200)}`,
            retryAfterMs,
            sourceDate,
          };
        }
        return {
          ok: true,
          status: response.status,
          data: JSON.parse(text) as T,
          error: null,
          retryAfterMs: null,
          sourceDate,
        };
      } catch (error: unknown) {
        return {
          ok: false,
          status: null,
          data: null,
          error: error instanceof Error ? error.message : String(error),
          retryAfterMs: null,
          sourceDate: null,
        };
      }
    });
    if (last.ok) return last;

    const retriable = last.status === null || last.status === 429 || last.status >= 500;
    if (!retriable || attempt === attempts - 1) return last;

    const backoff = (last.status === 429 ? 4 : 1) * 2 ** attempt * minGapMs;
    await delay(Math.min(Math.max(last.retryAfterMs ?? backoff, backoff), 120_000));
  }

  return last;
}

async function requestOnce<T>(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<FetchResult<T>> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'application/json',
        'user-agent': 'crypto-agents/0.1 (research tool)',
        ...headers,
      },
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: null,
        error: `HTTP ${response.status} ${response.statusText}`,
        retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
      };
    }
    return {
      ok: true,
      status: response.status,
      data: (await response.json()) as T,
      error: null,
      retryAfterMs: null,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      status: null,
      data: null,
      error: error instanceof Error ? error.message : String(error),
      retryAfterMs: null,
    };
  }
}

/** Разбирает Retry-After: секунды или дата. null — заголовка нет или он мусорный. */
function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(header);
  if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  return null;
}

/** Сериализует обращения к одному хосту и выдерживает между ними паузу. */
async function withHostSlot<T>(
  host: string,
  minGapMs: number,
  run: () => Promise<T>,
): Promise<T> {
  const previous = hostQueue.get(host) ?? Promise.resolve();
  const current = previous.then(async () => {
    const wait = (lastCallAt.get(host) ?? 0) + minGapMs - Date.now();
    if (wait > 0) await delay(wait);
    lastCallAt.set(host, Date.now());
    return run();
  });
  hostQueue.set(
    host,
    current.then(
      () => undefined,
      () => undefined,
    ),
  );
  return current;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown';
  }
}

/** Разбивает список на куски фиксированного размера. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

/** Возвращает конечное число или null — вместо тихого приведения к нулю. */
export function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
