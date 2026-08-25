import { CoingeckoService } from '../fetch/coingecko.service';
import { DefillamaService, FeeDataType } from '../fetch/defillama.service';
import { UniverseBuilder } from './universe.builder';
import { UniverseCandidate } from './universe.types';

function candidate(): UniverseCandidate {
  return {
    rank: 1,
    coingeckoId: 'aave',
    ticker: 'AAVE',
    name: 'Aave',
    priceUsd: 200,
    circulating: 10_000_000,
    totalSupply: 20_000_000,
    mcapCalcUsd: 2_000_000_000,
    mcapReportedUsd: 2_000_000_000,
    mcapDivergencePct: 0,
    fdvUsd: 4_000_000_000,
    vol24hUsd: 20_000_000,
    turnoverPct: 1,
    floatPct: 50,
    fdvToMcap: 2,
    marketSource: 'https://api.coingecko.com/old',
    marketAsOf: '2026-08-23T00:00:00.000Z',
    defillamaSlugs: ['aave-v3'],
    sector: 'lending',
    matchedBy: 'gecko_id',
    tvlUsd: 10_000_000_000,
    tvlSource: 'https://defillama.com/protocol/aave-v3',
    fees12mUsd: 400_000_000,
    revenue12mUsd: 80_000_000,
    holdersRevenue12mUsd: 30_000_000,
    revenue30dUsd: 6_000_000,
    holdersRevenue30dUsd: 2_000_000,
    revenueBasis: 'reported_1y',
    revenueSource: 'https://defillama.com/protocol/aave-v3',
    sourceHealthy: true,
    holderYieldPct: 1.5,
    takeRatePct: 20,
    payoutRatioPct: 37.5,
    pRev: 25,
    pFees: 5,
    fdvRev: 50,
    revenuePerTvlPct: 0.8,
    tier: 'yield',
    passed: true,
    rejectedAt: null,
    rejectReason: null,
  };
}

describe('UniverseBuilder.refreshNumbers', () => {
  const market = {
    coingeckoId: 'aave',
    ticker: 'AAVE',
    name: 'Aave',
    priceUsd: 250,
    mcapUsd: 2_500_000_000,
    fdvUsd: 5_000_000_000,
    vol24hUsd: 50_000_000,
    circulating: 10_000_000,
    totalSupply: 20_000_000,
    sourceUrl: 'https://api.coingecko.com/fresh',
    asOf: '2026-08-25T00:00:00.000Z',
  };

  function fees(dataType: FeeDataType) {
    const total1y =
      dataType === 'dailyFees'
        ? 500_000_000
        : dataType === 'dailyRevenue'
          ? 100_000_000
          : 50_000_000;
    return [
      {
        protocolId: '111',
        slug: 'aave-v3',
        name: 'Aave V3',
        category: 'Lending',
        protocolType: 'protocol',
        latestFetchIsOk: true,
        total30d: total1y / 12,
        total1y,
      },
    ];
  }

  it('пересчитывает числа и не меняет состав кандидата', async () => {
    const original = candidate();
    const coingecko = {
      getMarketsByIds: jest.fn().mockResolvedValue({ rows: [market], errors: [] }),
    } as unknown as CoingeckoService;
    const defillama = {
      getFeesOverview: jest.fn().mockImplementation(async (dataType: FeeDataType) =>
        fees(dataType),
      ),
    } as unknown as DefillamaService;
    const builder = new UniverseBuilder(coingecko, defillama);

    const output = await builder.refreshNumbers([original]);
    const [fresh] = output.candidates;

    expect(fresh).toMatchObject({
      coingeckoId: 'aave',
      rank: 1,
      defillamaSlugs: ['aave-v3'],
      priceUsd: 250,
      mcapCalcUsd: 2_500_000_000,
      fees12mUsd: 500_000_000,
      revenue12mUsd: 100_000_000,
      holdersRevenue12mUsd: 50_000_000,
      holderYieldPct: 2,
      pRev: 25,
    });
    expect(original.priceUsd).toBe(200);
    expect(defillama.getFeesOverview).toHaveBeenCalledTimes(3);
    expect(defillama.getFeesOverview).toHaveBeenCalledWith('dailyRevenue', {
      fresh: true,
    });
  });

  it('не сохраняет правдоподобный частичный результат при сбое пачки рынка', async () => {
    const coingecko = {
      getMarketsByIds: jest.fn().mockResolvedValue({
        rows: [],
        errors: ['HTTP 429'],
      }),
    } as unknown as CoingeckoService;
    const defillama = {
      getFeesOverview: jest.fn(),
    } as unknown as DefillamaService;
    const builder = new UniverseBuilder(coingecko, defillama);

    await expect(builder.refreshNumbers([candidate()])).rejects.toThrow('HTTP 429');
    expect(defillama.getFeesOverview).not.toHaveBeenCalled();
  });
});
