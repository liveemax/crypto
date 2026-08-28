import { EMPTY_TOKENOMICS } from '../src/core/tokenomics/tokenomics.constants';
import { UniverseCandidate } from 'src/core/universe/universe.types';
import { DEFAULT_PROFILE, YIELD_HUNTER_PROFILE } from '../src/config/profiles';
import { UniverseFilter } from '../src/core/universe/universe.filter';

function candidate(overrides: Partial<UniverseCandidate> = {}): UniverseCandidate {
  return {
    ...EMPTY_TOKENOMICS,
    rank: 1,
    coingeckoId: 'aave',
    ticker: 'AAVE',
    name: 'Aave',
    priceUsd: 250,
    circulating: 15_000_000,
    totalSupply: 16_000_000,
    mcapCalcUsd: 3_750_000_000,
    mcapReportedUsd: 3_750_000_000,
    mcapDivergencePct: 0,
    fdvUsd: 4_000_000_000,
    vol24hUsd: 200_000_000,
    turnoverPct: 5.33,
    floatPct: 93.75,
    fdvToMcap: 1.07,
    marketSource:'https://api.coingecko.com/api/v3/coins/markets',
    marketAsOf: new Date().toISOString(),
    defillamaSlugs: ['aave-v3'],
    sector: 'lending',
    rawSectors: [],
    comparisonGroup: 'lending',
    assetArchetype: 'protocol',
    revenueState: 'available',
    matchedBy: 'gecko_id',
    tvlUsd: 20_000_000_000,
    tvlSource: 'https://defillama.com/protocol/aave-v3',
    fees12mUsd: 520_000_000,
    revenue12mUsd: 112_000_000,
    holdersRevenue12mUsd: 60_000_000,
    revenue30dUsd: 9_000_000,
    holdersRevenue30dUsd: 5_000_000,
    revenueBasis: 'reported_1y',
    revenueSource: 'https://defillama.com/protocol/aave-v3',
    sourceHealthy: true,
    holderYieldPct: 1.6,
    takeRatePct: 21.54,
    payoutRatioPct: 53.57,
    pRev: 33.48,
    pFees: 7.21,
    fdvRev: 35.71,
    revenuePerTvlPct: 0.56,
    tier: 'pool',
    passed: false,
    rejectedAt: null,
    rejectReason: null,
    ...overrides,
  };
}

describe('UniverseFilter', () => {
  const filter = new UniverseFilter();

  it('не отсеивает дорогой L1: P/Rev — забота скринера, а не вселенной', () => {
    // Ethereum из справочной таблицы: P/Rev 275, выручка есть, доходность есть.
    const rows = [
      candidate({
        coingeckoId: 'ethereum',
        ticker: 'ETH',
        pRev: 275.6,
        revenue12mUsd: 820_000_000,
        holdersRevenue12mUsd: 7_600_000_000,
        matchedBy: 'chain',
      }),
    ];
    const report = filter.apply(rows);

    expect(rows[0].passed).toBe(true);
    expect(rows[0].tier).toBe('yield');
    expect(report.passed).toBe(1);
  });

  it('оставляет во вселенной токен без финансовых данных, но в тире pool', () => {
    const rows = [
      candidate({
        defillamaSlugs: [],
        matchedBy: 'none',
        fees12mUsd: null,
        revenue12mUsd: null,
        holdersRevenue12mUsd: null,
        holderYieldPct: null,
        pRev: null,
      }),
    ];
    filter.apply(rows);

    expect(rows[0].passed).toBe(true);
    expect(rows[0].tier).toBe('pool');
    expect(rows[0].rejectedAt).toBeNull();
  });

  it('различает тиры yield и economics по доходу держателя', () => {
    const rows = [
      candidate({ coingeckoId: 'a', holdersRevenue12mUsd: 0, holderYieldPct: 0 }),
      candidate({ coingeckoId: 'b' }),
    ];
    const report = filter.apply(rows);

    expect(rows[0].tier).toBe('economics');
    expect(rows[1].tier).toBe('yield');
    expect(report.tiers).toMatchObject({ yield: 1, economics: 1, rejected: 0 });
  });

  it('отсеивает низкий float: держатель платит за то, что ещё не выпущено', () => {
    const rows = [
      candidate({ circulating: 100_000_000, totalSupply: 1_000_000_000, floatPct: 10, fdvToMcap: 10 }),
    ];
    filter.apply(rows, new Set());

    expect(rows[0].rejectedAt).toBe('float_sane');
    expect(rows[0].rejectReason).toContain('разлоками');
  });

  it('не наказывает за неизвестную эмиссию', () => {
    const rows = [candidate({ totalSupply: null, floatPct: null, fdvToMcap: null })];
    filter.apply(rows, new Set());

    expect(rows[0].passed).toBe(true);
  });

  it('отсеивает неликвид с объяснением', () => {
    const rows = [candidate({ vol24hUsd: 1_000, turnoverPct: 0.00003 })];
    filter.apply(rows);

    expect(rows[0].rejectedAt).toBe('liquid');
    expect(rows[0].rejectReason).toContain('из позиции не выйти');
    expect(rows[0].tier).toBe('rejected');
  });

  it('отсеивает стейблкоин по цене, даже если реестр исключений не загрузился', () => {
    // USDT прошёл прошлый прогон: реестр не применился, а проверки цены не было.
    const rows = [
      candidate({
        coingeckoId: 'tether',
        ticker: 'USDT',
        name: 'Tether',
        priceUsd: 0.999811,
        turnoverPct: 47.51,
        revenue12mUsd: null,
        holdersRevenue12mUsd: null,
      }),
    ];
    filter.apply(rows, new Set());

    expect(rows[0].passed).toBe(false);
    expect(rows[0].rejectedAt).toBe('not_pegged');
  });

  it('отсеивает производную обёртку по названию', () => {
    const rows = [
      candidate({ coingeckoId: 'wrapped-steth', ticker: 'WSTETH', name: 'Wrapped stETH' }),
      candidate({ coingeckoId: 'staked-ether', ticker: 'STETH', name: 'Lido Staked Ether' }),
    ];
    filter.apply(rows, new Set());

    expect(rows.map((row) => row.rejectedAt)).toEqual([
      'not_derivative',
      'not_derivative',
    ]);
  });

  it('не считает привязкой цену, случайно оказавшуюся около единицы', () => {
    const rows = [candidate({ priceUsd: 1.08 })];
    filter.apply(rows, new Set());

    expect(rows[0].passed).toBe(true);
  });

  it('отсеивает то, что попало в исключаемые категории CoinGecko', () => {
    const rows = [candidate({ coingeckoId: 'dogecoin', ticker: 'DOGE' })];
    filter.apply(rows, new Set(['dogecoin']));

    expect(rows[0].rejectedAt).toBe('not_excluded');
  });

  it('отсеивает протокол со сломанным адаптером, а не молча берёт старые числа', () => {
    const rows = [candidate({ sourceHealthy: false })];
    filter.apply(rows);

    expect(rows[0].rejectedAt).toBe('source_healthy');
  });

  it('отсеивает убыточный протокол с отрицательной выручкой', () => {
    const rows = [candidate({ revenue12mUsd: -4_000_000 })];
    filter.apply(rows);

    expect(rows[0].rejectedAt).toBe('not_loss_making');
  });

  it('считает воронку: каждый шаг показывает вход, отсев и остаток', () => {
    const rows = [
      candidate({ coingeckoId: 'a' }),
      candidate({ coingeckoId: 'b', vol24hUsd: 100 }),
      candidate({ coingeckoId: 'c', sourceHealthy: false }),
    ];
    const report = filter.apply(rows);

    expect(report.total).toBe(3);
    expect(report.passed).toBe(1);
    expect(report.stages.find((stage) => stage.stage === 'liquid')?.dropped).toBe(1);
    expect(report.stages.at(-1)?.kept).toBe(1);
  });

  it('два профиля дают разный отсев на одних исходных кандидатах', () => {
    const original = candidate({ holderYieldPct: 0.5, payoutRatioPct: 10 });
    const defaultRows = [{ ...original, defillamaSlugs: [...original.defillamaSlugs] }];
    const yieldRows = [{ ...original, defillamaSlugs: [...original.defillamaSlugs] }];

    filter.apply(defaultRows, new Set(), DEFAULT_PROFILE);
    filter.apply(yieldRows, new Set(), YIELD_HUNTER_PROFILE);

    expect(defaultRows[0].passed).toBe(true);
    expect(yieldRows[0].passed).toBe(false);
    expect(yieldRows[0].rejectedAt).toBe('holder_yield');
    expect(original.passed).toBe(false);
  });
});
