import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DISCOVERY } from '../../config/discovery';
import { add, mul, round } from '../money';
import { StoreService } from '../store/store.service';
import { AgentContext, SnapshotRow } from '../types';
import { UniverseService } from '../universe/universe.service';
import { UniverseCandidate } from '../universe/universe.types';
import { CoingeckoService } from './coingecko.service';
import { DefillamaService, LlamaFeeRow, protocolPageUrl } from './defillama.service';

export interface SnapshotOptions {
  offline?: boolean;
}

const SNAPSHOT_NAME = 'universe';

@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);

  constructor(
    private readonly store: StoreService,
    private readonly defillama: DefillamaService,
    private readonly coingecko: CoingeckoService,
    private readonly universe: UniverseService,
  ) {}

  /**
   * Собирает снапшот. Без списка тикеров — по всей рабочей вселенной;
   * со списком — точечно, доливая строки в последний полный снапшот.
   */
  async build(tickers?: string[]): Promise<SnapshotRow[]> {
    const candidates = await this.universe.passed();
    if (candidates.length === 0) {
      throw new NotFoundException(
        'Рабочая вселенная пуста. Вызовите POST /universe/refresh и дождитесь окончания',
      );
    }

    const wanted = tickers?.map((ticker) => ticker.trim().toUpperCase());
    const selected = wanted
      ? candidates.filter((item) => wanted.includes(item.ticker))
      : candidates;

    if (wanted) {
      const missing = wanted.filter(
        (ticker) => !selected.some((item) => item.ticker === ticker),
      );
      if (missing.length > 0) {
        throw new NotFoundException(
          `Токены вне рабочей вселенной: ${missing.join(', ')}. ` +
            'Проверьте GET /universe — возможно, они отсеяны воронкой',
        );
      }
    }

    const rows = await this.buildRows(selected);

    // Частичный прогон не должен подменять собой полный снапшот вселенной.
    const previous = (await this.store.loadSnapshot<SnapshotRow[]>(SNAPSHOT_NAME)) ?? [];
    const merged = wanted ? mergeRows(previous, rows) : rows;
    await this.store.saveSnapshot(SNAPSHOT_NAME, merged);

    return rows;
  }

  /** Возвращает строку последнего снапшота или точечно загружает её из API. */
  async getRow(ticker: string, options: SnapshotOptions = {}): Promise<SnapshotRow> {
    const normalized = ticker.trim().toUpperCase();
    const snapshot = await this.store.loadSnapshot<SnapshotRow[]>(SNAPSHOT_NAME);
    const row = snapshot?.find((item) => item.ticker === normalized);
    if (row) return row;

    if (options.offline) {
      throw new NotFoundException(
        `Токен ${normalized} отсутствует в локальном снапшоте`,
      );
    }

    const [built] = await this.build([normalized]);
    if (!built) throw new NotFoundException(`Не удалось собрать строку для ${normalized}`);
    return built;
  }

  /**
   * Создаёт контекст агента: строки снапшота плюс кандидат вселенной со всеми
   * посчитанными метриками. Агенты не пересчитывают то, что уже посчитано.
   */
  async buildContext(
    ticker: string,
    options: SnapshotOptions = {},
  ): Promise<AgentContext> {
    const row = await this.getRow(ticker, options);
    const snapshot = await this.store.loadSnapshot<SnapshotRow[]>(SNAPSHOT_NAME);
    const universe = await this.universe.latest();
    const normalized = ticker.trim().toUpperCase();

    return {
      snapshot: snapshot ?? [row],
      candidate: universe?.candidates.find((item) => item.ticker === normalized),
      universeVersion: universe?.version ?? null,
    };
  }

  /** Возвращает последний сохранённый снапшот. */
  async latest(): Promise<SnapshotRow[]> {
    const snapshot = await this.store.loadSnapshot<SnapshotRow[]>(SNAPSHOT_NAME);
    if (!snapshot) throw new NotFoundException('Снапшот ещё не создан');
    return snapshot;
  }

  /**
   * Обновляет числа по готовому составу вселенной.
   * Состав (слаги, секторы) меняется раз в месяц, числа — при каждом вызове.
   */
  private async buildRows(candidates: UniverseCandidate[]): Promise<SnapshotRow[]> {
    const ids = candidates.map((item) => item.coingeckoId);
    const markets = await this.coingecko.getMarketsByIds(ids);
    const marketById = new Map(markets.rows.map((row) => [row.coingeckoId, row]));
    for (const error of markets.errors) this.logger.warn(`CoinGecko: ${error}`);

    const protocols = await this.defillama.getProtocols();
    const revenue = await this.defillama.getFeesOverview('dailyRevenue');
    const tvlBySlug = new Map(
      (protocols ?? []).map((item) => [item.slug, item.tvlUsd] as const),
    );
    const revenueBySlug = new Map<string, LlamaFeeRow>(
      (revenue ?? [])
        .filter((item): item is LlamaFeeRow & { slug: string } => item.slug !== null)
        .map((item) => [item.slug, item] as const),
    );

    const asOf = new Date().toISOString();
    const version = (await this.universe.latest())?.version ?? null;

    return candidates.map((candidate) => {
      const market = marketById.get(candidate.coingeckoId) ?? null;
      const errors: string[] = [];
      if (!market) errors.push('CoinGecko не вернул рыночные данные');

      let revenue1y: number | null = null;
      let revenue30d: number | null = null;
      let tvlUsd: number | null = null;
      for (const slug of candidate.defillamaSlugs) {
        const fees = revenueBySlug.get(slug);
        if (fees) {
          revenue1y = sumNullable(revenue1y, fees.total1y);
          revenue30d = sumNullable(revenue30d, fees.total30d);
        }
        tvlUsd = sumNullable(tvlUsd, tvlBySlug.get(slug) ?? null);
      }
      if (!protocols) errors.push('DeFiLlama не вернул список протоколов');
      if (!revenue) errors.push('DeFiLlama не вернул сводку выручки');
      if (revenue && revenue1y === null && revenue30d === null) {
        errors.push('DeFiLlama не отдаёт выручку по этому протоколу');
      }

      const priceUsd = market?.priceUsd ?? null;
      const circulating = market?.circulating ?? null;
      const primarySlug = candidate.defillamaSlugs[0] ?? null;

      const row: SnapshotRow = {
        mcapCalcUsd:
          priceUsd !== null && circulating !== null
            ? round(mul(priceUsd, circulating), 2)
            : null,
        asOfMarket: market?.asOf ?? null,
        asOfFees: asOf,
        asOfTvl: asOf,
        revenueBasis:
          revenue1y !== null
            ? 'reported_1y'
            : revenue30d !== null
              ? 'run_rate_30d'
              : 'none',
        universeVersion: version,
        ticker: candidate.ticker,
        name: candidate.name,
        sector: candidate.sector ?? 'unknown',
        asOf,
        priceUsd,
        mcapUsd:
          priceUsd !== null && circulating !== null
            ? round(mul(priceUsd, circulating), 2)
            : null,
        fdvUsd: market?.fdvUsd ?? null,
        vol24hUsd: market?.vol24hUsd ?? null,
        circulating,
        totalSupply: market?.totalSupply ?? null,
        revenue1y,
        revenue30d,
        tvlUsd,
        mcapSource: market?.sourceUrl ?? null,
        feesSource: primarySlug ? protocolPageUrl(primarySlug) : null,
        tvlSource: primarySlug ? protocolPageUrl(primarySlug) : null,
        errors,
      };

      return row;
    });
  }
}

/** Доливает свежие строки в предыдущий снапшот, не теряя остальную вселенную. */
function mergeRows(previous: SnapshotRow[], fresh: SnapshotRow[]): SnapshotRow[] {
  const byTicker = new Map(previous.map((row) => [row.ticker, row] as const));
  for (const row of fresh) byTicker.set(row.ticker, row);
  return [...byTicker.values()].sort((left, right) =>
    left.ticker.localeCompare(right.ticker),
  );
}

/** Складывает суммы версий протокола через decimal.js, не превращая null в ноль. */
function sumNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return add(left, right);
}

/** Годовой run-rate из 30-дневной выручки, если факта за год нет. */
export function revenue12m(
  revenue1y: number | null,
  revenue30d: number | null,
): number | null {
  if (revenue1y !== null) return revenue1y;
  if (revenue30d !== null) return round(mul(revenue30d, DISCOVERY.runRate30dToYear), 2);
  return null;
}