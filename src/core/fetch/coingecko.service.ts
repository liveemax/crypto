import { Injectable } from '@nestjs/common';
import { StoreService } from '../store/store.service';
import { chunk, fetchJson, isRecord, nullableNumber } from './fetch.utils';
import { DISCOVERY } from '../../config/discovery';
const BASE = 'https://api.coingecko.com/api/v3';

export interface CoinMarket {
  coingeckoId: string;
  ticker: string;
  name: string;
  priceUsd: number | null;
  /** Капитализация в том виде, в каком её отдаёт CoinGecko. */
  mcapUsd: number | null;
  fdvUsd: number | null;
  vol24hUsd: number | null;
  circulating: number | null;
  totalSupply: number | null;
  /** Ссылка без ключа API: она попадёт в отчёт и должна открываться в браузере. */
  sourceUrl: string;
  /** Время обновления данных на стороне источника, а не время нашего запроса. */
  asOf: string | null;
}

/** Событие загрузки одной страницы рынка — для счётчика прогресса и диагностики. */
export interface MarketPageEvent {
  page: number;
  pages: number;
  rowsOnPage: number;
  loaded: number;
  ok: boolean;
  status: number | null;
  error: string | null;
}

/** Сколько подряд упавших страниц считается недоступностью источника. */
const MAX_CONSECUTIVE_FAILURES = 3;

@Injectable()
export class CoingeckoService {
  constructor(private readonly store: StoreService) {}

  /** Возвращает страницы рынка по убыванию капитализации: один запрос на 250 монет. */
  async getTopMarkets(
    limit: number = DISCOVERY.fetchN,
    onPage?: (event: MarketPageEvent) => void,
  ): Promise<{ rows: CoinMarket[]; errors: string[] }> {
    const pages = Math.ceil(limit / DISCOVERY.pageSize);
    const rows: CoinMarket[] = [];
    const errors: string[] = [];
    let consecutiveFailures = 0;

    for (let page = 1; page <= pages; page += 1) {
      const query =
        `vs_currency=usd&order=market_cap_desc&per_page=${DISCOVERY.pageSize}` +
        `&page=${page}&sparkline=false&locale=en`;
      const sourceUrl = `${BASE}/coins/markets?${query}`;

      // Единственный источник, который раньше не кэшировался: даже честная
      // пересборка тянула все страницы рынка заново.
      const cacheKey = `markets-p${page}-s${DISCOVERY.pageSize}`;
      const cached = await this.store.cacheGet<CoinMarket[]>('coingecko', cacheKey);
      if (cached) {
        rows.push(...cached);
        onPage?.({
          page,
          pages,
          rowsOnPage: cached.length,
          loaded: rows.length,
          ok: true,
          status: null,
          error: null,
        });
        if (cached.length === 0) break;
        continue;
      }

      const response = await fetchJson<unknown>(withKey(sourceUrl));

      if (!response.ok || !Array.isArray(response.data)) {
        const error =
          response.error ??
          (response.ok ? 'ответ не является массивом' : 'неизвестная ошибка');
        errors.push(`Страница ${page}: ${error}`);
        consecutiveFailures += 1;
        onPage?.({
          page,
          pages,
          rowsOnPage: 0,
          loaded: rows.length,
          ok: false,
          status: response.status,
          error,
        });

        // Источник лёг. Продолжать — значит незаметно собрать обрезанную вселенную
        // и сравнивать в следующем месяце несопоставимые составы.
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          throw new Error(
            `CoinGecko недоступен: ${consecutiveFailures} страницы подряд с ошибкой ` +
              `(страница ${page} из ${pages}), последняя — ${error}`,
          );
        }
        continue;
      }

      consecutiveFailures = 0;
      await this.store.saveRaw('coingecko-markets', `page-${page}`, response.data);
      const parsed: CoinMarket[] = [];
      for (const item of response.data) {
        const row = toMarket(item, sourceUrl);
        if (row) parsed.push(row);
      }
      await this.store.cachePut('coingecko', cacheKey, parsed);
      rows.push(...parsed);
      const rowsOnPage = parsed.length;
      onPage?.({
        page,
        pages,
        rowsOnPage,
        loaded: rows.length,
        ok: true,
        status: response.status,
        error: null,
      });

      // Пустая страница означает конец списка монет, а не сбой.
      if (rowsOnPage === 0) break;
    }

    return { rows: rows.slice(0, limit), errors };
  }

  /**
   * Возвращает состав категории CoinGecko: список идентификаторов монет.
   * Используется для отсева стейблов, обёрток и мемкоинов по данным, а не по
   * списку, написанному руками.
   */
  async getCategoryIds(category: string): Promise<string[] | null> {
    const query =
      `vs_currency=usd&category=${encodeURIComponent(category)}` +
      `&order=market_cap_desc&per_page=${DISCOVERY.pageSize}&page=1&sparkline=false`;
    const response = await fetchJson<unknown>(withKey(`${BASE}/coins/markets?${query}`));
    if (!response.ok || !Array.isArray(response.data)) return null;
    return response.data
      .filter(isRecord)
      .map((item) => (typeof item.id === 'string' ? item.id : null))
      .filter((id): id is string => id !== null);
  }

  /** Возвращает свежие рыночные данные по списку монет пачками по 250. */
  async getMarketsByIds(
    ids: readonly string[],
  ): Promise<{ rows: CoinMarket[]; errors: string[] }> {
    const rows: CoinMarket[] = [];
    const errors: string[] = [];

    for (const [index, part] of chunk(ids, DISCOVERY.pageSize).entries()) {
      const query =
        `vs_currency=usd&ids=${part.map(encodeURIComponent).join(',')}` +
        `&per_page=${DISCOVERY.pageSize}&page=1&sparkline=false&locale=en`;
      const sourceUrl = `${BASE}/coins/markets?${query}`;
      const response = await fetchJson<unknown>(withKey(sourceUrl));

      if (!response.ok || !Array.isArray(response.data)) {
        errors.push(
          `Пачка из ${part.length} монет: ${response.error ?? 'ответ не является массивом'}`,
        );
        continue;
      }
      await this.store.saveRaw('coingecko-markets', `ids-${index + 1}`, response.data);
      for (const item of response.data) {
        const row = toMarket(item, sourceUrl);
        if (row) rows.push(row);
      }
    }

    return { rows, errors };
  }

  /** Возвращает рыночные данные одной монеты, используя суточный кэш. */
  async getMarket(id: string): Promise<CoinMarket | null> {
    const cached = await this.store.cacheGet<CoinMarket>('coingecko-market', id);
    if (cached) return cached;

    const sourceUrl =
      `${BASE}/coins/${encodeURIComponent(id)}?localization=false&tickers=false` +
      `&market_data=true&community_data=false&developer_data=false`;
    const response = await fetchJson<unknown>(withKey(sourceUrl));
    if (!response.ok || !isRecord(response.data)) return null;

    const raw = response.data;
    await this.store.saveRaw('coingecko', id, raw);
    if (!isRecord(raw.market_data)) return null;

    const market = raw.market_data;
    const result: CoinMarket = {
      coingeckoId: id,
      ticker: typeof raw.symbol === 'string' ? raw.symbol.toUpperCase() : id.toUpperCase(),
      name: typeof raw.name === 'string' ? raw.name : id,
      priceUsd: usd(market.current_price),
      mcapUsd: usd(market.market_cap),
      fdvUsd: usd(market.fully_diluted_valuation),
      vol24hUsd: usd(market.total_volume),
      circulating: nullableNumber(market.circulating_supply),
      totalSupply: nullableNumber(market.total_supply),
      sourceUrl,
      asOf: typeof market.last_updated === 'string' ? market.last_updated : null,
    };
    return this.store.cachePut('coingecko-market', id, result);
  }
}

/** Добавляет ключ Demo-плана в запрос, не подмешивая его в сохраняемую ссылку. */
function withKey(url: string): string {
  const key = process.env.COINGECKO_API_KEY;
  return key ? `${url}&x_cg_demo_api_key=${encodeURIComponent(key)}` : url;
}

function toMarket(item: unknown, sourceUrl: string): CoinMarket | null {
  if (!isRecord(item) || typeof item.id !== 'string') return null;
  return {
    coingeckoId: item.id,
    ticker:
      typeof item.symbol === 'string' ? item.symbol.toUpperCase() : item.id.toUpperCase(),
    name: typeof item.name === 'string' ? item.name : item.id,
    priceUsd: nullableNumber(item.current_price),
    mcapUsd: nullableNumber(item.market_cap),
    fdvUsd: nullableNumber(item.fully_diluted_valuation),
    vol24hUsd: nullableNumber(item.total_volume),
    circulating: nullableNumber(item.circulating_supply),
    totalSupply: nullableNumber(item.total_supply),
    sourceUrl,
    asOf: typeof item.last_updated === 'string' ? item.last_updated : null,
  };
}

function usd(value: unknown): number | null {
  return isRecord(value) ? nullableNumber(value.usd) : null;
}
