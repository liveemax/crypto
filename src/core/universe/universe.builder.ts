import { Injectable } from '@nestjs/common';
import { DISCOVERY, SLUG_OVERRIDES } from '../../config/discovery';
import { CoingeckoService, CoinMarket } from '../fetch/coingecko.service';
import {
  chainPageUrl,
  DefillamaService,
  feesOverviewUrl,
  FeeDataType,
  LlamaFeeRow,
  LlamaProtocol,
  PROTOCOLS_URL,
  CHAINS_URL,
  protocolPageUrl,
  slugify,
} from '../fetch/defillama.service';
import { add, div, mul, round, sub } from '../money';
import { BuildProgressEvent, UniverseCandidate } from './universe.types';

interface ProtocolGroup {
  slugs: string[];
  category: string | null;
  tvlUsd: number | null;
  bestTvl: number;
  isChain: boolean;
}

interface FeeTotals {
  total30d: number | null;
  total1y: number | null;
  healthy: boolean;
}

export interface BuildOutput {
  candidates: UniverseCandidate[];
  sources: Record<string, string>;
  excluded: Set<string>;
  warnings: string[];
}

const FEE_TYPES: FeeDataType[] = ['dailyFees', 'dailyRevenue', 'dailyHoldersRevenue'];

@Injectable()
export class UniverseBuilder {
  constructor(
    private readonly coingecko: CoingeckoService,
    private readonly defillama: DefillamaService,
  ) {}

  /** Склеивает рынок CoinGecko с протоколами, сетями и тремя сводками комиссий. */
  async build(
    topN: number = DISCOVERY.topN,
    onProgress?: (event: BuildProgressEvent) => void,
  ): Promise<BuildOutput> {
    const warnings: string[] = [];
    const limit = Math.max(topN, DISCOVERY.fetchN);

    const markets = await this.coingecko.getTopMarkets(limit, (page) =>
      onProgress?.({
        step: 'markets',
        label: 'Рынок CoinGecko',
        current: page.page,
        total: page.pages,
        loaded: page.loaded,
        failed: !page.ok,
        error:
          page.error === null
            ? null
            : `HTTP ${page.status ?? 'нет ответа'}: ${page.error}`,
      }),
    );
    warnings.push(...markets.errors.map((error) => `CoinGecko: ${error}`));
    if (markets.rows.length === 0) {
      throw new Error('CoinGecko не вернул ни одной строки рынка');
    }
    const loaded = markets.rows.length;

    const excluded = await this.loadExcludedIds(loaded, warnings, onProgress);

    onProgress?.(step('protocols', 'Список протоколов DeFiLlama', 0, 1, loaded));
    const protocols = await this.defillama.getProtocols();
    if (!protocols) {
      throw new Error(
        'DeFiLlama не вернул список протоколов. Проверьте api.llama.fi/protocols вручную',
      );
    }
    onProgress?.(
      step('protocols', `Протоколов DeFiLlama: ${protocols.length}`, 1, 1, loaded),
    );

    onProgress?.(step('chains', 'Список сетей DeFiLlama', 0, 1, loaded));
    const chains = await this.defillama.getChains();
    if (!chains) warnings.push('DeFiLlama не вернул список сетей: L1 останутся без экономики');
    onProgress?.(
      step('chains', `Сетей DeFiLlama: ${chains?.length ?? 0}`, 1, 1, loaded),
    );

    const fees = new Map<FeeDataType, LlamaFeeRow[]>();
    for (const [index, dataType] of FEE_TYPES.entries()) {
      onProgress?.(
        step('fees', `Сводка ${dataType}`, index, FEE_TYPES.length, loaded),
      );
      const rows = await this.defillama.getFeesOverview(dataType);
      if (!rows) {
        throw new Error(
          `DeFiLlama не вернул сводку ${dataType}. Проверьте ${feesOverviewUrl(dataType)} вручную`,
        );
      }
      fees.set(dataType, rows);
      onProgress?.(
        step(
          'fees',
          `Сводка ${dataType}: ${rows.length}`,
          index + 1,
          FEE_TYPES.length,
          loaded,
        ),
      );
    }

    onProgress?.(step('join', 'Склейка источников по gecko_id', 0, 1, loaded));

    const groups = groupProtocols(protocols);
    for (const chain of chains ?? []) {
      if (!chain.geckoId) continue;
      const slug = slugify(chain.name);
      const current = groups.get(chain.geckoId);
      // Сеть дополняет протокол того же токена, а не затирает его.
      groups.set(chain.geckoId, {
        slugs: [...(current?.slugs ?? []), slug],
        category: current?.category ?? 'Chain',
        tvlUsd: addNullable(current?.tvlUsd ?? null, chain.tvlUsd),
        bestTvl: Math.max(current?.bestTvl ?? -1, chain.tvlUsd ?? 0),
        isChain: true,
      });
    }

    const geckoBySlug = new Map<string, string>();
    const geckoByProtocolId = new Map<string, string>();
    for (const protocol of protocols) {
      if (!protocol.geckoId) continue;
      geckoBySlug.set(protocol.slug, protocol.geckoId);
      geckoByProtocolId.set(protocol.id, protocol.geckoId);
    }
    for (const chain of chains ?? []) {
      if (chain.geckoId) geckoBySlug.set(slugify(chain.name), chain.geckoId);
    }

    const totals = new Map<FeeDataType, Map<string, FeeTotals>>();
    for (const dataType of FEE_TYPES) {
      totals.set(
        dataType,
        aggregateFees(fees.get(dataType) ?? [], geckoByProtocolId, geckoBySlug),
      );
    }

    const candidates = markets.rows
      .map((row) => toCandidate(row, groups, totals, warnings))
      .sort(byMcapDesc)
      .slice(0, topN)
      .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

    const unmatched = candidates.filter((item) => item.matchedBy === 'none').length;
    warnings.push(
      `Без соответствия в DeFiLlama: ${unmatched} из ${candidates.length}`,
    );

    const sources: Record<string, string> = {
      markets: markets.rows[0]?.sourceUrl ?? '',
      protocols: PROTOCOLS_URL,
      chains: CHAINS_URL,
    };
    for (const dataType of FEE_TYPES) sources[dataType] = feesOverviewUrl(dataType);

    return { candidates, sources, excluded, warnings };
  }

  /**
   * Собирает список исключений из данных, а не из списка в коде.
   * Каждый источник отчитывается в warnings: молча не применённый отсев —
   * это фильтр, которого нет, но который выглядит работающим.
   */
  private async loadExcludedIds(
    loaded: number,
    warnings: string[],
    onProgress?: (event: BuildProgressEvent) => void,
  ): Promise<Set<string>> {
    const excluded = new Set<string>(DISCOVERY.excludedCoingeckoIds);

    onProgress?.(step('categories', 'Реестр стейблкоинов DeFiLlama', 0, 1, loaded));
    const stablecoins = await this.defillama.getStablecoinGeckoIds();
    if (stablecoins === null || stablecoins.length === 0) {
      warnings.push('ОТСЕВ НЕ ПРИМЕНЁН: реестр стейблкоинов DeFiLlama не загрузился');
    } else {
      for (const id of stablecoins) excluded.add(id);
      warnings.push(`Реестр стейблкоинов DeFiLlama: ${stablecoins.length} монет`);
    }

    const categories: string[] = [...DISCOVERY.excludedCoingeckoCategories];
    if (DISCOVERY.excludeMemecoins) categories.push(DISCOVERY.memecoinCategory);

    let applied = 0;
    for (const [index, category] of categories.entries()) {
      onProgress?.(
        step('categories', `Категория ${category}`, index, categories.length, loaded),
      );
      const ids = await this.coingecko.getCategoryIds(category);
      if (ids === null || ids.length === 0) {
        warnings.push(
          `ОТСЕВ НЕ ПРИМЕНЁН: категория ${category} вернула ` +
            `${ids === null ? 'ошибку' : 'пустой список'}`,
        );
        continue;
      }
      applied += 1;
      for (const id of ids) excluded.add(id);
      warnings.push(`Категория ${category}: ${ids.length} монет`);
      onProgress?.(
        step(
          'categories',
          `Категория ${category}: ${ids.length}`,
          index + 1,
          categories.length,
          loaded,
        ),
      );
    }

    if (applied === 0) {
      warnings.push(
        'Ни одна категория CoinGecko не загрузилась: отсев держится только на ' +
          'реестре стейблкоинов и на проверках цены и названия',
      );
    }
    warnings.push(`Всего в списке исключений: ${excluded.size}`);
    return excluded;
  }
}

function step(
  name: BuildProgressEvent['step'],
  label: string,
  current: number,
  total: number,
  loaded: number,
): BuildProgressEvent {
  return { step: name, label, current, total, loaded, failed: false, error: null };
}

/** Собирает версии одного протокола под общий gecko_id: aave-v2 и aave-v3 — это Aave. */
function groupProtocols(protocols: LlamaProtocol[]): Map<string, ProtocolGroup> {
  const excludedCategories = DISCOVERY.excludedLlamaCategories as readonly string[];
  const groups = new Map<string, ProtocolGroup>();

  for (const protocol of protocols) {
    if (!protocol.geckoId) continue;
    if (protocol.category && excludedCategories.includes(protocol.category)) continue;

    const current = groups.get(protocol.geckoId);
    const tvl = protocol.tvlUsd ?? 0;
    groups.set(protocol.geckoId, {
      slugs: [...(current?.slugs ?? []), protocol.slug],
      category: tvl > (current?.bestTvl ?? -1) ? protocol.category : (current?.category ?? null),
      tvlUsd: addNullable(current?.tvlUsd ?? null, protocol.tvlUsd),
      bestTvl: Math.max(current?.bestTvl ?? -1, tvl),
      isChain: current?.isChain ?? false,
    });
  }
  return groups;
}

/** Складывает версии протокола и сети под gecko_id, помечая сломанные адаптеры. */
function aggregateFees(
  rows: LlamaFeeRow[],
  geckoByProtocolId: Map<string, string>,
  geckoBySlug: Map<string, string>,
): Map<string, FeeTotals> {
  const result = new Map<string, FeeTotals>();
  const seen = new Set<string>();

  for (const row of rows) {
    const key = `${row.protocolId ?? ''}|${row.slug ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const geckoId =
      (row.protocolId ? geckoByProtocolId.get(row.protocolId) : undefined) ??
      (row.slug ? geckoBySlug.get(row.slug) : undefined);
    if (!geckoId) continue;

    const current = result.get(geckoId);
    result.set(geckoId, {
      total30d: addNullable(current?.total30d ?? null, row.total30d),
      total1y: addNullable(current?.total1y ?? null, row.total1y),
      healthy: (current?.healthy ?? true) && row.latestFetchIsOk,
    });
  }
  return result;
}

function toCandidate(
  row: CoinMarket,
  groups: Map<string, ProtocolGroup>,
  totals: Map<FeeDataType, Map<string, FeeTotals>>,
  warnings: string[],
): UniverseCandidate {
  const mcapCalcUsd =
    row.priceUsd !== null && row.circulating !== null
      ? round(mul(row.priceUsd, row.circulating), 2)
      : null;

  const divergence =
    mcapCalcUsd !== null && row.mcapUsd !== null && row.mcapUsd > 0
      ? round(Math.abs(mul(sub(div(mcapCalcUsd, row.mcapUsd), 1), 100)), 2)
      : null;
  if (divergence !== null && divergence > DISCOVERY.maxMcapDivergencePct) {
    warnings.push(
      `${row.ticker}: своя капитализация расходится с заявленной на ${divergence}%`,
    );
  }

  const override = SLUG_OVERRIDES[row.coingeckoId];
  const group = groups.get(row.coingeckoId);
  const slugs = override ?? group?.slugs ?? [];
  const matchedBy = override
    ? 'override'
    : group?.isChain
      ? 'chain'
      : group
        ? 'gecko_id'
        : 'none';

  const feeTotals = totals.get('dailyFees')?.get(row.coingeckoId) ?? null;
  const revenueTotals = totals.get('dailyRevenue')?.get(row.coingeckoId) ?? null;
  const holderTotals = totals.get('dailyHoldersRevenue')?.get(row.coingeckoId) ?? null;

  const revenue12mUsd = annual(revenueTotals);
  const fees12mUsd = annual(feeTotals);
  const holdersRevenue12mUsd = annual(holderTotals);
  const revenueBasis =
    revenueTotals === null
      ? 'none'
      : revenueTotals.total1y !== null
        ? 'reported_1y'
        : revenueTotals.total30d !== null
          ? 'run_rate_30d'
          : 'none';

  const primarySlug = slugs[0] ?? null;
  const sourceUrl = primarySlug
    ? group?.isChain && !override
      ? chainPageUrl(primarySlug)
      : protocolPageUrl(primarySlug)
    : null;

  return {
    rank: 0,
    coingeckoId: row.coingeckoId,
    ticker: row.ticker,
    name: row.name,
    priceUsd: row.priceUsd,
    circulating: row.circulating,
    totalSupply: row.totalSupply,
    mcapCalcUsd,
    mcapReportedUsd: row.mcapUsd,
    mcapDivergencePct: divergence,
    fdvUsd: row.fdvUsd,
    vol24hUsd: row.vol24hUsd,
    turnoverPct: pct(row.vol24hUsd, mcapCalcUsd),
    floatPct: pct(row.circulating, row.totalSupply),
    fdvToMcap: ratio(row.fdvUsd, mcapCalcUsd),
    marketSource: row.sourceUrl,
    marketAsOf: row.asOf,
    defillamaSlugs: slugs,
    sector: normalizeSector(group?.category ?? null),
    matchedBy,
    tvlUsd: group?.tvlUsd ?? null,
    tvlSource: sourceUrl,
    fees12mUsd,
    revenue12mUsd,
    holdersRevenue12mUsd,
    revenue30dUsd: revenueTotals?.total30d ?? null,
    holdersRevenue30dUsd: holderTotals?.total30d ?? null,
    revenueBasis,
    revenueSource: sourceUrl,
    sourceHealthy: revenueTotals?.healthy ?? true,
    holderYieldPct: pct(holdersRevenue12mUsd, mcapCalcUsd),
    takeRatePct: pct(revenue12mUsd, fees12mUsd),
    payoutRatioPct: pct(holdersRevenue12mUsd, revenue12mUsd),
    pRev: ratio(mcapCalcUsd, revenue12mUsd),
    pFees: ratio(mcapCalcUsd, fees12mUsd),
    fdvRev: ratio(row.fdvUsd, revenue12mUsd),
    revenuePerTvlPct: pct(revenue12mUsd, group?.tvlUsd ?? null),
    tier: 'pool',
    passed: false,
    rejectedAt: null,
    rejectReason: null,
  };
}

/** Годовая величина: факт за 365 дней, иначе run-rate из 30 дней. */
function annual(totals: FeeTotals | null): number | null {
  if (totals === null) return null;
  if (totals.total1y !== null) return round(totals.total1y, 2);
  if (totals.total30d !== null) {
    return round(mul(totals.total30d, DISCOVERY.runRate30dToYear), 2);
  }
  return null;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return round(div(numerator, denominator), 2);
}

function pct(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null || whole <= 0) return null;
  return round(mul(div(part, whole), 100), 2);
}

function addNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return add(left, right);
}

function normalizeSector(category: string | null): string | null {
  return category ? slugify(category) : null;
}

function byMcapDesc(left: UniverseCandidate, right: UniverseCandidate): number {
  return (right.mcapCalcUsd ?? -1) - (left.mcapCalcUsd ?? -1);
}
