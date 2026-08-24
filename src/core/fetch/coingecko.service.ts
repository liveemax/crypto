import { Injectable } from "@nestjs/common";
import { StoreService } from "../store/store.service";
import { fetchJson } from "./fetch.utils";

export interface CoinMarket {
  priceUsd: number | null;
  mcapUsd: number | null;
  fdvUsd: number | null;
  vol24hUsd: number | null;
  circulating: number | null;
  totalSupply: number | null;
  sourceUrl: string;
}

@Injectable()
export class CoingeckoService {
  constructor(private readonly store: StoreService) {}

  /** Возвращает рыночные данные монеты, используя суточный кэш. */
  async getMarket(id: string): Promise<CoinMarket | null> {
    const cached = await this.store.cacheGet<CoinMarket>(
      "coingecko-market",
      id,
    );
    if (cached) return cached;
    const sourceUrl = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`;
    const raw = await fetchJson(sourceUrl);
    if (raw === null) return null;
    await this.store.saveRaw("coingecko", id, raw);
    if (!isRecord(raw)) return null;
    if (!isRecord(raw.market_data)) return null;
    const market = raw.market_data;
    const result = {
      priceUsd: usd(market.current_price),
      mcapUsd: usd(market.market_cap),
      fdvUsd: usd(market.fully_diluted_valuation),
      vol24hUsd: usd(market.total_volume),
      circulating: nullableNumber(market.circulating_supply),
      totalSupply: nullableNumber(market.total_supply),
      sourceUrl,
    };
    return this.store.cachePut("coingecko-market", id, result);
  }
}

function usd(value: unknown): number | null {
  return isRecord(value) ? nullableNumber(value.usd) : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
