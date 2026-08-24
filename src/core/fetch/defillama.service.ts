import { Injectable } from "@nestjs/common";
import { StoreService } from "../store/store.service";
import { fetchJson } from "./fetch.utils";

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

  /** Возвращает агрегированную выручку протокола, используя суточный кэш. */
  async getFees(slug: string): Promise<DefillamaFees | null> {
    const cached = await this.store.cacheGet<DefillamaFees>(
      "defillama-fees",
      slug,
    );
    if (cached) return cached;
    const sourceUrl = `https://api.llama.fi/summary/fees/${encodeURIComponent(slug)}?dataType=dailyRevenue`;
    const raw = await fetchJson(sourceUrl);
    if (raw === null) return null;
    await this.store.saveRaw("defillama-fees", slug, raw);
    if (!isRecord(raw)) return null;
    const result = {
      total24h: nullableNumber(raw.total24h),
      total30d: nullableNumber(raw.total30d),
      total1y: nullableNumber(raw.total1y),
      sourceUrl,
    };
    return this.store.cachePut("defillama-fees", slug, result);
  }

  /** Возвращает текущий TVL протокола, используя суточный кэш. */
  async getTvl(slug: string): Promise<DefillamaTvl | null> {
    const cached = await this.store.cacheGet<DefillamaTvl>(
      "defillama-tvl",
      slug,
    );
    if (cached) return cached;
    const sourceUrl = `https://api.llama.fi/protocol/${encodeURIComponent(slug)}`;
    const raw = await fetchJson(sourceUrl);
    if (raw === null) return null;
    if (!isRecord(raw)) {
      await this.store.saveRaw("defillama-tvl", slug, raw);
      return null;
    }
    const { chainTvls: _chainTvls, ...rawWithoutChainTvls } = raw;
    await this.store.saveRaw("defillama-tvl", slug, rawWithoutChainTvls);
    const result = { tvlUsd: currentTvl(raw), sourceUrl };
    return this.store.cachePut("defillama-tvl", slug, result);
  }
}

function currentTvl(raw: Record<string, unknown>): number | null {
  const direct = nullableNumber(raw.tvl);
  if (direct !== null) return direct;
  if (!Array.isArray(raw.tvl) || raw.tvl.length === 0) return null;
  const last = raw.tvl.at(-1);
  return isRecord(last) ? nullableNumber(last.totalLiquidityUSD) : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
