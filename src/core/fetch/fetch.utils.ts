export interface FetchOptions {
  attempts?: number;
  pauseMs?: number;
}

/** Выполняет HTTP-запрос с паузой и экспоненциальными повторами. */
export async function fetchJson(
  url: string,
  options: FetchOptions = {},
): Promise<unknown> {
  const attempts = options.attempts ?? 3;
  const pauseMs = options.pauseMs ?? 1_200;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (pauseMs > 0) await sleep(pauseMs);
    try {
      const response = await fetch(url);
      if (response.ok) return (await response.json()) as unknown;
      if (
        attempt === attempts - 1 ||
        (response.status < 500 && response.status !== 429)
      )
        return null;
      await sleep((response.status === 429 ? 4 : 1) * 2 ** attempt * pauseMs);
    } catch {
      if (attempt === attempts - 1) return null;
      await sleep(2 ** attempt * pauseMs);
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
