import { Injectable, NotFoundException } from "@nestjs/common";
import { findByTicker, UNIVERSE, UniverseItem } from "../../config/universe";
import { AgentContext, SnapshotRow } from "../types";
import { StoreService } from "../store/store.service";
import { CoingeckoService } from "./coingecko.service";
import { DefillamaService } from "./defillama.service";

export interface SnapshotOptions {
  offline?: boolean;
}

@Injectable()
export class SnapshotService {
  constructor(
    private readonly store: StoreService,
    private readonly defillama: DefillamaService,
    private readonly coingecko: CoingeckoService,
  ) {}

  /** Собирает и сохраняет снапшот выбранных активов или всей вселенной. */
  async build(tickers?: string[]): Promise<SnapshotRow[]> {
    const items =
      tickers?.map((ticker) => {
        const item = findByTicker(ticker);
        if (!item)
          throw new NotFoundException(
            `Токен ${ticker} отсутствует во вселенной`,
          );
        return item;
      }) ?? UNIVERSE;
    const rows: SnapshotRow[] = [];
    for (const item of items) rows.push(await this.buildRow(item));
    await this.store.saveSnapshot("universe", rows);
    return rows;
  }

  /** Возвращает строку последнего снапшота или точечно загружает её из API. */
  async getRow(
    ticker: string,
    options: SnapshotOptions = {},
  ): Promise<SnapshotRow> {
    const normalized = ticker.trim().toUpperCase();
    const snapshot = await this.store.loadSnapshot<SnapshotRow[]>("universe");
    const row = snapshot?.find((item) => item.ticker === normalized);
    if (row) return row;
    if (options.offline)
      throw new NotFoundException(
        `Токен ${normalized} отсутствует в локальном снапшоте`,
      );
    const item = findByTicker(normalized);
    if (!item)
      throw new NotFoundException(
        `Токен ${normalized} отсутствует во вселенной`,
      );
    return this.buildRow(item);
  }

  /** Создаёт контекст агента на основе последнего локального снапшота. */
  async buildContext(
    ticker: string,
    options: SnapshotOptions = {},
  ): Promise<AgentContext> {
    await this.getRow(ticker, options);
    const snapshot = await this.store.loadSnapshot<SnapshotRow[]>("universe");
    return { snapshot: snapshot ?? [await this.getRow(ticker, options)] };
  }

  /** Возвращает последний сохранённый снапшот. */
  async latest(): Promise<SnapshotRow[]> {
    const snapshot = await this.store.loadSnapshot<SnapshotRow[]>("universe");
    if (!snapshot) throw new NotFoundException("Снапшот ещё не создан");
    return snapshot;
  }

  private async buildRow(item: UniverseItem): Promise<SnapshotRow> {
    const [fees, tvl, market] = await Promise.all([
      this.defillama.getFees(item.defillama),
      this.defillama.getTvl(item.defillama),
      this.coingecko.getMarket(item.coingecko),
    ]);
    const errors: string[] = [];
    if (!fees) errors.push("Не удалось получить выручку DeFiLlama");
    else if (fees.total1y === null) errors.push("DeFiLlama не вернул выручку за год");
    if (!tvl) errors.push("Не удалось получить TVL DeFiLlama");
    else if (tvl.tvlUsd === null) errors.push("DeFiLlama не вернул текущий TVL");
    if (!market) errors.push("Не удалось получить рыночные данные CoinGecko");
    else if (market.mcapUsd === null) errors.push("CoinGecko не вернул капитализацию");
    const asOf = new Date().toISOString();
    return {
      ticker: item.ticker,
      name: item.name,
      sector: item.sector,
      asOf,
      priceUsd: market?.priceUsd ?? null,
      mcapUsd: market?.mcapUsd ?? null,
      fdvUsd: market?.fdvUsd ?? null,
      vol24hUsd: market?.vol24hUsd ?? null,
      circulating: market?.circulating ?? null,
      totalSupply: market?.totalSupply ?? null,
      revenue1y: fees?.total1y ?? null,
      revenue30d: fees?.total30d ?? null,
      tvlUsd: tvl?.tvlUsd ?? null,
      mcapSource: market?.sourceUrl ?? null,
      feesSource: fees?.sourceUrl ?? null,
      tvlSource: tvl?.sourceUrl ?? null,
      errors,
    };
  }
}
