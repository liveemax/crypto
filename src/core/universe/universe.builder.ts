import { Injectable } from '@nestjs/common';
import { DISCOVERY, SLUG_OVERRIDES } from '../../config/discovery';
import { SECTOR_MAP, SectorMapEntry } from '../../config/sector-map';
import { applyComparisonIdentity, revenueStateOf } from './comparison';
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
import { overhangPctOf } from '../tokenomics/tokenomics.calc';
import { EMPTY_TOKENOMICS } from '../tokenomics/tokenomics.constants';

interface ProtocolGroup {
  slugs: string[];
  category: string | null;
  tvlUsd: number | null;
  bestTvl: number;
  isChain: boolean;
  /** Каким признаком нашли монету: прямой gecko_id или совпадение тикера. */
  matchedBy: 'gecko_id' | 'symbol';
  /** Сколько версий протокола вошло в группу — индикатор частичной склейки. */
  versions: number;
}

/** Группа версий до того, как ей подобрана монета CoinGecko. */
interface RawGroup {
  slugs: string[];
  category: string | null;
  tvlUsd: number | null;
  bestTvl: number;
  geckoId: string | null;
  symbols: Set<string>;
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

export interface RefreshNumbersOutput {
  candidates: UniverseCandidate[];
  sources: Record<string, string>;
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
    // Недобор состава — отказ, а не примечание: обрезанная вселенная выглядит
    // собранной, а через месяц сравнивается с полной как с сопоставимой.
    if (markets.rows.length < topN) {
      throw new Error(
        `Запрошено ${topN} монет, загружено ${markets.rows.length}. ` +
          `Причина: ${markets.errors.join('; ') || 'страницы кончились раньше'}. ` +
          'Успешные страницы лежат в суточном кэше — повторный ' +
          'POST /universe/refresh?force=true дотянет только недостающие.',
      );
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

    // Тикер → монета. Дубли тикеров выбрасываются целиком: угадывать, какой из
    // двух одноимённых токенов имелся в виду, опаснее, чем не склеить вовсе.
    const tickerIndex = new Map<string, string>();
    const ambiguous = new Set<string>();
    for (const row of markets.rows) {
      const ticker = row.ticker.toUpperCase();
      if (tickerIndex.has(ticker)) ambiguous.add(ticker);
      tickerIndex.set(ticker, row.coingeckoId);
    }
    for (const ticker of ambiguous) tickerIndex.delete(ticker);

    // Оракулы, мосты и сервисы зарабатывают, ничего не удерживая: у Chainlink
    // TVL ноль в обеих записях. Порог по TVL терял этот класс целиком, поэтому
    // пропуском к склейке по тикеру служит ещё и наличие строки в сводке комиссий.
    const earningSlugs = new Set<string>();
    for (const row of fees.get('dailyFees') ?? []) {
      if (row.slug) earningSlugs.add(row.slug);
    }

    const groups = groupProtocols(protocols, tickerIndex, earningSlugs, warnings);
    for (const chain of chains ?? []) {
      if (!chain.geckoId) continue;
      const slug = slugify(chain.name);
      const current = groups.get(chain.geckoId);
      // Сеть дополняет протокол того же токена, а не затирает его.
      groups.set(chain.geckoId, {
        // Протокол и сеть часто носят один слаг. Дубль не удваивает выручку
        // кандидата, но SnapshotRow суммирует по этому массиву — и там удваивает.
        slugs: [...new Set([...(current?.slugs ?? []), slug])],
        category: current?.category ?? 'Chain',
        tvlUsd: addNullable(current?.tvlUsd ?? null, chain.tvlUsd),
        bestTvl: Math.max(current?.bestTvl ?? -1, chain.tvlUsd ?? 0),
        isChain: true,
        matchedBy: current?.matchedBy ?? 'gecko_id',
        versions: (current?.versions ?? 0) + 1,
      });
    }

    // Карты строятся из групп, а не из отдельных протоколов. Иначе выручка
    // aave-v3 и uniswap-v3 не находит свою монету — у них пустой gecko_id.
    // Слаги из SLUG_OVERRIDES кладутся сюда же: раньше оверрайд давал слаги
    // кандидату, но комиссии по ним никто не искал, и HYPE оставался без чисел.
    const slugToGecko = new Map<string, string>();
    for (const [geckoId, group] of groups) {
      for (const slug of group.slugs) slugToGecko.set(slug, geckoId);
    }
    for (const [geckoId, slugs] of Object.entries(SLUG_OVERRIDES)) {
      for (const slug of slugs) slugToGecko.set(slug, geckoId);
    }

    const geckoBySlug = new Map<string, string>();
    const geckoByProtocolId = new Map<string, string>();
    for (const protocol of protocols) {
      const geckoId = slugToGecko.get(protocol.slug);
      if (!geckoId) continue;
      geckoBySlug.set(protocol.slug, geckoId);
      geckoByProtocolId.set(protocol.id, geckoId);
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

    const sectorMap = await this.loadSectorMap(loaded, warnings, onProgress);
    applyComparisonIdentity(candidates, sectorMap, warnings);

    return { candidates, sources, excluded, warnings };
  }

  /** Обновляет рыночные и финансовые числа, не меняя состав и метаданные вселенной. */
  async refreshNumbers(
    candidates: readonly UniverseCandidate[],
  ): Promise<RefreshNumbersOutput> {
    const warnings: string[] = [];
    const ids = candidates.map((candidate) => candidate.coingeckoId);
    const markets = await this.coingecko.getMarketsByIds(ids);
    if (markets.errors.length > 0) {
      throw new Error(`CoinGecko не обновил все пачки: ${markets.errors.join('; ')}`);
    }
    const marketById = new Map(markets.rows.map((market) => [market.coingeckoId, market]));

    const geckoBySlug = new Map<string, string>();
    for (const candidate of candidates) {
      for (const slug of candidate.defillamaSlugs) {
        geckoBySlug.set(slug, candidate.coingeckoId);
      }
    }

    const totals = new Map<FeeDataType, Map<string, FeeTotals>>();
    for (const dataType of FEE_TYPES) {
      const rows = await this.defillama.getFeesOverview(dataType, { fresh: true });
      if (!rows) {
        throw new Error(
          `DeFiLlama не обновил ${dataType}. Проверьте ${feesOverviewUrl(dataType)} вручную`,
        );
      }
      totals.set(
        dataType,
        aggregateFees(rows, new Map<string, string>(), geckoBySlug),
      );
    }

    const refreshed = candidates.map((candidate) => {
      const market = marketById.get(candidate.coingeckoId) ?? null;
      if (!market) {
        warnings.push(`CoinGecko не вернул рыночные данные для ${candidate.coingeckoId}`);
      }
      const updated = refreshCandidate(candidate, market, totals, warnings);
      // Числа изменились — состояние выручки пересчитывается: known_zero прошлого
      // прогона не должен пережить появление выручки.
      updated.revenueState = revenueStateOf(updated);
      return updated;
    });

    const sources: Record<string, string> = {};
    if (markets.rows[0]) sources.markets = markets.rows[0].sourceUrl;
    for (const dataType of FEE_TYPES) sources[dataType] = feesOverviewUrl(dataType);
    return { candidates: refreshed, sources, warnings };
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
    const failed: string[] = [];
    const broken: string[] = [];
    for (const [index, category] of categories.entries()) {
      onProgress?.(
        step('categories', `Категория ${category}`, index, categories.length, loaded),
      );
      const result = await this.coingecko.getCategoryIds(category);
      const ids = result.ids;
      if (ids === null || ids.length === 0) {
        // Пустой список при успешном ответе — не сбой: у CoinGecko неизвестная
        // категория отдаёт 200 и пустой массив. Повтор такое не лечит.
        const wrongId =
          ids !== null ||
          (result.status !== null && result.status >= 400 && result.status !== 429);
        const why =
          ids !== null
            ? 'HTTP 200 и пустой список — /coins/markets не отдаёт состав этой ' +
              'категории. Идентификатор может быть верным: сверьте и по ' +
              '/coins/categories/list, и прямым запросом markets'
            : `HTTP ${result.status ?? 'нет ответа'} — источник недоступен, поможет повтор`;
        if (wrongId) broken.push(`${category}: ${why}`);
        else failed.push(`${category}: ${why}`);
        warnings.push(`ОТСЕВ НЕ ПРИМЕНЁН: категория ${category}, ${why}`);
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

    if (broken.length > 0) {
      throw new Error(
        `Категории не дали состав: ${broken.join('; ')}. Повтор не поможет — ` +
          'нужна замена идентификатора в DISCOVERY.excludedCoingeckoCategories ' +
          'или осознанное удаление строки. Держать мёртвую категорию нельзя: ' +
          'отсев, которого нет, выглядит работающим.',
      );
    }
    if (failed.length > 0) {
      throw new Error(
        `Источник не отдал категории: ${failed.join('; ')}. Вселенная с непримененным ` +
          'отсевом выглядит собранной, но содержит мемкоины и обёртки. Загруженные ' +
          'категории лежат в суточном кэше — повторный POST /universe/refresh?force=true ' +
          'дотянет только упавшие и займёт секунды.',
      );
    }
    warnings.push(`Всего в списке исключений: ${excluded.size}`);
    return excluded;
  }

  /**
   * Группы сравнения для монет, которых DeFiLlama не знает. Карта категорий —
   * в git, под ревью: собирать группы «по похожести» значит получать разный
   * состав ниши в каждом прогоне.
   *
   * В отличие от реестра исключений отказ категории сборку НЕ валит: неприменённая
   * группа не притворяется работающей — она поднимает долю пробелов, которую видно
   * числом в GET /universe/coverage и которая ловится гейтом.
   */
  private async loadSectorMap(
    loaded: number,
    warnings: string[],
    onProgress?: (event: BuildProgressEvent) => void,
  ): Promise<Map<string, SectorMapEntry[]>> {
    const matched = new Map<string, SectorMapEntry[]>();
    const failed: string[] = [];
    let applied = 0;

    for (const [index, entry] of SECTOR_MAP.entries()) {
      onProgress?.(
        step('categories', `Группа ${entry.group}`, index, SECTOR_MAP.length, loaded),
      );
      const result = await this.coingecko.getCategoryIds(entry.category);
      const ids = result.ids;
      if (ids === null || ids.length === 0) {
        failed.push(`${entry.category} (HTTP ${result.status ?? 'нет ответа'})`);
        continue;
      }
      applied += 1;
      for (const id of ids) {
        // Порядок карты — приоритет, но хранятся ВСЕ совпадения: сеть, попавшая
        // в тематическую категорию, должна получить следующую подходящую,
        // а не первую попавшуюся.
        const list = matched.get(id);
        if (list) list.push(entry);
        else matched.set(id, [entry]);
      }
      onProgress?.(
        step(
          'categories',
          `Группа ${entry.group}: ${ids.length}`,
          index + 1,
          SECTOR_MAP.length,
          loaded,
        ),
      );
    }

    warnings.push(
      `Карта секторов: применено ${applied} из ${SECTOR_MAP.length} категорий, ` +
        `${matched.size} монет попали хотя бы в одну`,
    );
    if (failed.length > 0) {
      warnings.push(
        `КАРТА СЕКТОРОВ НЕПОЛНАЯ: ${failed.join('; ')}. Доля без группы вырастет — ` +
          'смотрите GET /universe/coverage, а не эти warnings',
      );
    }
    return matched;
  }
}


function refreshCandidate(
  candidate: UniverseCandidate,
  market: CoinMarket | null,
  totals: Map<FeeDataType, Map<string, FeeTotals>>,
  warnings: string[],
): UniverseCandidate {
  const priceUsd = market?.priceUsd ?? null;
  const circulating = market?.circulating ?? null;
  const totalSupply = market?.totalSupply ?? null;
  const fdvUsd = market?.fdvUsd ?? null;
  const vol24hUsd = market?.vol24hUsd ?? null;
  const mcapCalcUsd =
    priceUsd !== null && circulating !== null
      ? round(mul(priceUsd, circulating), 2)
      : null;
  const divergence =
    mcapCalcUsd !== null && market?.mcapUsd !== null && market?.mcapUsd !== undefined &&
    market.mcapUsd > 0
      ? round(Math.abs(mul(sub(div(mcapCalcUsd, market.mcapUsd), 1), 100)), 2)
      : null;
  if (divergence !== null && divergence > DISCOVERY.maxMcapDivergencePct) {
    warnings.push(
      `${candidate.ticker}: своя капитализация расходится с заявленной на ${divergence}%`,
    );
  }

  const feeTotals = totals.get('dailyFees')?.get(candidate.coingeckoId) ?? null;
  const revenueTotals = totals.get('dailyRevenue')?.get(candidate.coingeckoId) ?? null;
  const holderTotals =
    totals.get('dailyHoldersRevenue')?.get(candidate.coingeckoId) ?? null;
  const fees12mUsd = annual(feeTotals);
  const revenue12mUsd = annual(revenueTotals);
  const holdersRevenue12mUsd = annual(holderTotals);
  const revenueBasis =
    revenueTotals === null
      ? 'none'
      : revenueTotals.total1y !== null
        ? 'reported_1y'
        : revenueTotals.total30d !== null
          ? 'run_rate_30d'
          : 'none';

  return {
    ...candidate,
    priceUsd,
    circulating,
    totalSupply,
    mcapCalcUsd,
    mcapReportedUsd: market?.mcapUsd ?? null,
    mcapDivergencePct: divergence,
    fdvUsd,
    vol24hUsd,
    turnoverPct: pct(vol24hUsd, mcapCalcUsd),
    floatPct: pct(circulating, totalSupply),
    fdvToMcap: ratio(fdvUsd, mcapCalcUsd),
    // Эмиссия изменилась — навес пересчитывается; календарные поля пересчитает
    // applyTokenomics, у которого есть файл фактов.
    overhangPct: overhangPctOf(circulating, totalSupply),
    marketSource: market?.sourceUrl ?? null,
    marketAsOf: market?.asOf ?? null,
    fees12mUsd,
    revenue12mUsd,
    holdersRevenue12mUsd,
    revenue30dUsd: revenueTotals?.total30d ?? null,
    holdersRevenue30dUsd: holderTotals?.total30d ?? null,
    revenueBasis,
    sourceHealthy: revenueTotals?.healthy ?? true,
    holderYieldPct: pct(holdersRevenue12mUsd, mcapCalcUsd),
    takeRatePct: pct(revenue12mUsd, fees12mUsd),
    payoutRatioPct: pct(holdersRevenue12mUsd, revenue12mUsd),
    pRev: ratio(mcapCalcUsd, revenue12mUsd),
    pFees: ratio(mcapCalcUsd, fees12mUsd),
    fdvRev: ratio(fdvUsd, revenue12mUsd),
    revenuePerTvlPct: pct(revenue12mUsd, candidate.tvlUsd),
    tier: 'pool',
    passed: false,
    rejectedAt: null,
    rejectReason: null,
  };
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
function groupProtocols(
  protocols: LlamaProtocol[],
  tickerIndex: Map<string, string>,
  earningSlugs: ReadonlySet<string>,
  warnings: string[],
): Map<string, ProtocolGroup> {
  const excludedCategories = DISCOVERY.excludedLlamaCategories as readonly string[];
  const raw = new Map<string, RawGroup>();

  // Версия протокола редко знает свой gecko_id: у Aave он есть только у мёртвой
  // v2 с TVL 111 млн, тогда как живая v3 держит 17.3 млрд. Группировка по
  // parentProtocol переносит найденный идентификатор на все версии сразу.
  for (const protocol of protocols) {
    if (protocol.category && excludedCategories.includes(protocol.category)) continue;

    const key = protocol.parentProtocol ?? protocol.slug;
    const current = raw.get(key);
    const tvl = protocol.tvlUsd ?? 0;
    const symbols = current?.symbols ?? new Set<string>();
    if (protocol.symbol) symbols.add(protocol.symbol.toUpperCase());

    raw.set(key, {
      slugs: [...(current?.slugs ?? []), protocol.slug],
      category:
        tvl > (current?.bestTvl ?? -1) ? protocol.category : (current?.category ?? null),
      tvlUsd: addNullable(current?.tvlUsd ?? null, protocol.tvlUsd),
      bestTvl: Math.max(current?.bestTvl ?? -1, tvl),
      geckoId: current?.geckoId ?? protocol.geckoId,
      symbols,
    });
  }

  const taken = new Set<string>();
  for (const group of raw.values()) if (group.geckoId) taken.add(group.geckoId);

  // Uniswap, Morpho, Ethena и Ondo не знают gecko_id ни в одной версии —
  // наследовать не от кого, остаётся тикер. Тикер принадлежит группе версий,
  // а не строке: AAVE носят v2, v3, v4 и horizon, и это один проект.
  // Конфликт — когда один тикер заявляют две разные группы.
  const eligible = [...raw.entries()].filter(
    ([, group]) =>
      group.geckoId === null &&
      ((group.tvlUsd ?? 0) >= DISCOVERY.minSymbolMatchTvlUsd ||
        group.slugs.some((slug) => earningSlugs.has(slug))),
  );

  const claims = new Map<string, Set<string>>();
  for (const [key, group] of eligible) {
    for (const symbol of group.symbols) {
      const geckoId = tickerIndex.get(symbol);
      if (!geckoId || taken.has(geckoId)) continue;
      claims.set(symbol, (claims.get(symbol) ?? new Set<string>()).add(key));
    }
  }

  const conflicts: string[] = [];
  const contested = new Set<string>();
  for (const [symbol, keys] of claims) {
    if (keys.size > 1) {
      contested.add(symbol);
      conflicts.push(`${symbol} → ${[...keys].join(' / ')}`);
    }
  }

  const bySymbol = new Map<string, string>();
  for (const [key, group] of eligible) {
    const found = new Set<string>();
    for (const symbol of group.symbols) {
      if (contested.has(symbol)) continue;
      const geckoId = tickerIndex.get(symbol);
      if (geckoId && !taken.has(geckoId)) found.add(geckoId);
    }
    if (found.size === 1) bySymbol.set(key, [...found][0]);
    else if (found.size > 1) conflicts.push(`группа ${key} → ${[...found].join(' / ')}`);
  }

  const groups = new Map<string, ProtocolGroup>();
  const counts = { gecko_id: 0, symbol: 0 };

  for (const [key, group] of raw) {
    const geckoId = group.geckoId ?? bySymbol.get(key) ?? null;
    if (!geckoId) continue;
    const matchedBy: 'gecko_id' | 'symbol' = group.geckoId ? 'gecko_id' : 'symbol';
    counts[matchedBy] += 1;

    const current = groups.get(geckoId);
    const slugs = [...new Set([...(current?.slugs ?? []), ...group.slugs])];
    groups.set(geckoId, {
      slugs,
      category:
        group.bestTvl > (current?.bestTvl ?? -1)
          ? group.category
          : (current?.category ?? null),
      tvlUsd: addNullable(current?.tvlUsd ?? null, group.tvlUsd),
      bestTvl: Math.max(current?.bestTvl ?? -1, group.bestTvl),
      isChain: current?.isChain ?? false,
      matchedBy: current?.matchedBy ?? matchedBy,
      versions: slugs.length,
    });
  }

  const multi = [...groups.values()].filter((group) => group.versions > 1).length;
  warnings.push(
    `Склейка DeFiLlama: по gecko_id ${counts.gecko_id}, по тикеру ${counts.symbol}, ` +
      `групп с несколькими версиями ${multi}`,
  );
  if (conflicts.length > 0) {
    warnings.push(
      `Тикер не склеен из-за неоднозначности (${conflicts.length}): ` +
        conflicts.slice(0, 20).join('; '),
    );
  }
  return groups;
}

/** Складывает версии протокола и сети под gecko_id, помечая сломанные адаптеры. */
function aggregateFees(
  rows: LlamaFeeRow[],
  geckoByProtocolId: Map<string, string>,
  geckoBySlug: Map<string, string>,
): Map<string, FeeTotals> {
  // Слаг у DeFiLlama — уникальный ключ страницы. Две записи с одним слагом это
  // один протокол, показанный дважды: обычно строкой сети и строкой протокола.
  // Прежний ключ из пары protocolId|slug их не ловил, и выручка складывалась
  // сама с собой — 28 сетей во вселенной имели дубли слагов.
  const unique = new Map<string, LlamaFeeRow>();
  for (const row of rows) {
    const key = row.slug ?? row.protocolId;
    if (!key) continue;
    const current = unique.get(key);
    if (!current || (row.total1y ?? -1) > (current.total1y ?? -1)) unique.set(key, row);
  }

  const result = new Map<string, FeeTotals>();

  for (const row of unique.values()) {
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
      : (group?.matchedBy ?? 'none');

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
    revenuePerTvlPct: tvlYield(revenue12mUsd, group?.tvlUsd ?? null, row.ticker, warnings),
    // Разлоки заполняет POST /universe/tokenomics; навес известен уже сейчас,
    // он считается из снимка и чужих адаптеров не требует.
    ...EMPTY_TOKENOMICS,
    overhangPct: overhangPctOf(row.circulating, row.totalSupply),
    // Заполняется вторым проходом: карта категорий грузится один раз на сборку,
    // а не по монете.
    rawSectors: [],
    comparisonGroup: null,
    assetArchetype: 'other',
    revenueState: 'source_missing',
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

/**
 * Выручка к TVL. Число не обнуляется — при малом TVL оно бывает настоящим, —
 * но абсурдная величина уходит в warnings с обеими исходными цифрами.
 * У Canton вышло 9647%, и с таким pRev он возглавил бы рейтинг сектора.
 */
function tvlYield(
  revenue: number | null,
  tvl: number | null,
  ticker: string,
  warnings: string[],
): number | null {
  const value = pct(revenue, tvl);
  if (value !== null && value > DISCOVERY.maxRevenuePerTvlPct) {
    warnings.push(
      `${ticker}: выручка ${Math.round(revenue ?? 0)} USD при TVL ${Math.round(tvl ?? 0)} USD, ` +
        `${Math.round(value)}% — похоже на склейку чужих комиссий, проверьте вручную`,
    );
  }
  return value;
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

