import { Injectable } from '@nestjs/common';
import { StoreService } from '../store/store.service';
import { fetchJson, isRecord, nullableNumber } from './fetch.utils';

const BASE = 'https://api.llama.fi';

/**
 * Типы финансовых данных DeFiLlama.
 * revenue = fees − supplySideRevenue, то есть валовая прибыль протокола.
 * holdersRevenue — часть выручки, дошедшая до держателей токена:
 * выкуп, стейкинг из комиссий, включённый fee switch.
 */
export type FeeDataType = 'dailyFees' | 'dailyRevenue' | 'dailyHoldersRevenue';

export const PROTOCOLS_URL = `${BASE}/protocols`;
export const CHAINS_URL = `${BASE}/v2/chains`;
export const STABLECOINS_URL = 'https://stablecoins.llama.fi/stablecoins';

/** Ссылка на сводку выбранного типа данных по всем протоколам. */
export function feesOverviewUrl(dataType: FeeDataType): string {
  return (
    `${BASE}/overview/fees?excludeTotalDataChart=true` +
    `&excludeTotalDataChartBreakdown=true&dataType=${dataType}`
  );
}

export interface LlamaProtocol {
  id: string;
  slug: string;
  name: string;
  /** Идентификатор монеты на CoinGecko — ключ склейки двух источников. */
  geckoId: string | null;
  /** Тикер токена протокола: последний шанс склейки, когда gecko_id пуст везде. */
  symbol: string | null;
  category: string | null;
  tvlUsd: number | null;
  parentProtocol: string | null;
}

export interface LlamaChain {
  name: string;
  geckoId: string | null;
  tvlUsd: number | null;
  tokenSymbol: string | null;
}

export interface LlamaFeeRow {
  protocolId: string | null;
  slug: string | null;
  name: string;
  category: string | null;
  /** protocol или chain — L1 приходят в той же сводке. */
  protocolType: string | null;
  /** false означает, что адаптер сломался и числа устарели. */
  latestFetchIsOk: boolean;
  total30d: number | null;
  total1y: number | null;
}

export interface DefillamaFees {
  total24h: number | null;
  total30d: number | null;
  total1y: number | null;
  sourceUrl: string;
}

export interface DefillamaTvl {
  tvlUsd: number | null;
  sourceUrl: string;
}

@Injectable()
export class DefillamaService {
  constructor(private readonly store: StoreService) {}

  /** Возвращает все протоколы одним запросом: слаг, категория, TVL и gecko_id. */
  async getProtocols(): Promise<LlamaProtocol[] | null> {
    const cached = await this.store.cacheGet<LlamaProtocol[]>('defillama', 'protocols');
    if (cached) return cached;

    const response = await fetchJson<unknown>(PROTOCOLS_URL, { timeoutMs: 60_000 });
    if (!response.ok || !Array.isArray(response.data)) return null;

    const trimmed = response.data.filter(isRecord).map((item) => {
      const { chainTvls: _chainTvls, tokenBreakdowns: _breakdowns, ...rest } = item;
      return rest;
    });
    await this.store.saveRaw('defillama-protocols', 'all', trimmed);

    const protocols = trimmed
      .map(toProtocol)
      .filter((item): item is LlamaProtocol => item !== null);
    return this.store.cachePut('defillama', 'protocols', protocols);
  }

  /** Возвращает сети с их gecko_id: без этого L1 не попадают во вселенную. */
  async getChains(): Promise<LlamaChain[] | null> {
    const cached = await this.store.cacheGet<LlamaChain[]>('defillama', 'chains');
    if (cached) return cached;

    const response = await fetchJson<unknown>(CHAINS_URL, { timeoutMs: 30_000 });
    if (!response.ok || !Array.isArray(response.data)) return null;

    await this.store.saveRaw('defillama-chains', 'all', response.data);
    const chains = response.data.filter(isRecord).map(
      (item): LlamaChain => ({
        name: typeof item.name === 'string' ? item.name : 'unknown',
        geckoId: typeof item.gecko_id === 'string' && item.gecko_id ? item.gecko_id : null,
        tvlUsd: nullableNumber(item.tvl),
        tokenSymbol: typeof item.tokenSymbol === 'string' ? item.tokenSymbol : null,
      }),
    );
    return this.store.cachePut('defillama', 'chains', chains);
  }
  /**
   * Возвращает gecko_id всех стейблкоинов из реестра DeFiLlama.
   * Реестр отдаёт gecko_id напрямую, поэтому склейка точная, а не по символу.
   */
  async getStablecoinGeckoIds(): Promise<string[] | null> {
    const cached = await this.store.cacheGet<string[]>('defillama', 'stablecoins');
    if (cached) return cached;

    const response = await fetchJson<unknown>(STABLECOINS_URL, { timeoutMs: 30_000 });
    if (!response.ok || !isRecord(response.data)) return null;
    if (!Array.isArray(response.data.peggedAssets)) return null;

    await this.store.saveRaw('defillama-stablecoins', 'all', response.data.peggedAssets);
    const ids = response.data.peggedAssets
      .filter(isRecord)
      .map((item) => (typeof item.gecko_id === 'string' ? item.gecko_id : null))
      .filter((id): id is string => id !== null && id.length > 0);
    return this.store.cachePut('defillama', 'stablecoins', ids);
  }

  /** Возвращает сводку комиссий; fresh обходит кэш при явном обновлении чисел. */
  async getFeesOverview(
    dataType: FeeDataType,
    options: { fresh?: boolean } = {},
  ): Promise<LlamaFeeRow[] | null> {
    if (!options.fresh) {
      const cached = await this.store.cacheGet<LlamaFeeRow[]>('defillama', dataType);
      if (cached) return cached;
    }

    const response = await fetchJson<unknown>(feesOverviewUrl(dataType), {
      timeoutMs: 60_000,
    });
    if (!response.ok || !isRecord(response.data)) return null;
    if (!Array.isArray(response.data.protocols)) return null;

    await this.store.saveRaw('defillama-fees', dataType, response.data.protocols);
    const rows = response.data.protocols.filter(isRecord).map(toFeeRow);
    return this.store.cachePut('defillama', dataType, rows);
  }

  /** Возвращает агрегированную выручку одного протокола, используя суточный кэш. */
  async getFees(slug: string): Promise<DefillamaFees | null> {
    const cached = await this.store.cacheGet<DefillamaFees>('defillama-fees', slug);
    if (cached) return cached;

    const sourceUrl = `${BASE}/summary/fees/${encodeURIComponent(slug)}?dataType=dailyRevenue`;
    const response = await fetchJson<unknown>(sourceUrl);
    if (!response.ok || !isRecord(response.data)) return null;

    await this.store.saveRaw('defillama-fees', slug, response.data);
    const raw = response.data;
    const result: DefillamaFees = {
      total24h: nullableNumber(raw.total24h),
      total30d: nullableNumber(raw.total30d),
      total1y: nullableNumber(raw.total1y),
      sourceUrl,
    };
    return this.store.cachePut('defillama-fees', slug, result);
  }

  /** Возвращает текущий TVL одного протокола, используя суточный кэш. */
  async getTvl(slug: string): Promise<DefillamaTvl | null> {
    const cached = await this.store.cacheGet<DefillamaTvl>('defillama-tvl', slug);
    if (cached) return cached;

    const sourceUrl = `${BASE}/protocol/${encodeURIComponent(slug)}`;
    const response = await fetchJson<unknown>(sourceUrl);
    if (!response.ok || !isRecord(response.data)) return null;

    const { chainTvls: _chainTvls, tokensInUsd: _tokensInUsd, tokens: _tokens, ...rest } =
      response.data;
    await this.store.saveRaw('defillama-tvl', slug, rest);

    const result: DefillamaTvl = { tvlUsd: currentTvl(response.data), sourceUrl };
    return this.store.cachePut('defillama-tvl', slug, result);
  }
}

/** Человекочитаемая ссылка на протокол — её можно открыть и сверить руками. */
export function protocolPageUrl(slug: string): string {
  return `https://defillama.com/protocol/${slug}`;
}

/** Человекочитаемая ссылка на сеть. */
export function chainPageUrl(name: string): string {
  return `https://defillama.com/chain/${name}`;
}

/** Приводит имя сети к виду слага DeFiLlama: Ethereum → ethereum. */
export function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

function toProtocol(item: Record<string, unknown>): LlamaProtocol | null {
  const slug = typeof item.slug === 'string' ? item.slug : null;
  if (!slug) return null;
  return {
    id: typeof item.id === 'string' ? item.id : String(item.id ?? slug),
    slug,
    name: typeof item.name === 'string' ? item.name : slug,
    geckoId: typeof item.gecko_id === 'string' && item.gecko_id ? item.gecko_id : null,
    symbol:
      typeof item.symbol === 'string' && item.symbol && item.symbol !== '-'
        ? item.symbol
        : null,
    category: typeof item.category === 'string' ? item.category : null,
    tvlUsd: nullableNumber(item.tvl),
    parentProtocol:
      typeof item.parentProtocol === 'string' ? item.parentProtocol : null,
  };
}

function toFeeRow(item: Record<string, unknown>): LlamaFeeRow {
  return {
    protocolId:
      typeof item.defillamaId === 'string'
        ? item.defillamaId
        : typeof item.defillamaId === 'number'
          ? String(item.defillamaId)
          : null,
    slug: typeof item.slug === 'string' ? item.slug : null,
    name: typeof item.name === 'string' ? item.name : 'unknown',
    category: typeof item.category === 'string' ? item.category : null,
    protocolType: typeof item.protocolType === 'string' ? item.protocolType : null,
    latestFetchIsOk: item.latestFetchIsOk !== false,
    total30d: nullableNumber(item.total30d),
    total1y: nullableNumber(item.total1y),
  };
}

function currentTvl(raw: Record<string, unknown>): number | null {
  const direct = nullableNumber(raw.tvl);
  if (direct !== null) return direct;
  if (!Array.isArray(raw.tvl) || raw.tvl.length === 0) return null;
  const last: unknown = raw.tvl.at(-1);
  return isRecord(last) ? nullableNumber(last.totalLiquidityUSD) : null;
}
