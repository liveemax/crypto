import { NotFoundException } from '@nestjs/common';
import { CoingeckoService } from '../src/core/fetch/coingecko.service';
import { DefillamaService } from '../src/core/fetch/defillama.service';
import { SnapshotService } from '../src/core/fetch/snapshot.service';
import { StoreService } from '../src/core/store/store.service';
import { SnapshotRow } from '../src/core/types';
import { UniverseService } from '../src/core/universe/universe.service';
import { UniverseCandidate } from '../src/core/universe/universe.types';

function candidate(overrides: Partial<UniverseCandidate> = {}): UniverseCandidate {
  return {
    rank: 1,
    coingeckoId: 'aave',
    ticker: 'AAVE',
    name: 'Aave',
    priceUsd: 250,
    circulating: 15_000_000,
    totalSupply: 16_000_000,
    mcapCalcUsd: 3_750_000_000,
    mcapReportedUsd: 3_700_000_000,
    mcapDivergencePct: 1.35,
    fdvUsd: 4_000_000_000,
    vol24hUsd: 200_000_000,
    marketSource: 'https://api.coingecko.com/api/v3/coins/markets',
    marketAsOf: '2026-08-24T11:00:00.000Z',
    turnoverPct: 5.33,
    floatPct: 93.75,
    fdvToMcap: 1.07,
    defillamaSlugs:['aave-v3'],
    sector: 'lending',
    matchedBy: 'gecko_id',
    tvlUsd: 20_000_000_000,
    tvlSource: 'https://defillama.com/protocol/aave-v3',
    fees12mUsd: 420_000_000,
    revenue12mUsd: 92_000_000,
    holdersRevenue12mUsd: 50_000_000,
    revenue30dUsd: 7_500_000,
    holdersRevenue30dUsd: 4_000_000,
    revenueBasis: 'reported_1y',
    revenueSource: 'https://defillama.com/protocol/aave-v3',
    sourceHealthy: true,
    holderYieldPct: 1.33,
    takeRatePct: 21.9,
    payoutRatioPct: 54.35,
    pRev: 40.76,
    pFees: 8.93,
    fdvRev: 43.47,
    revenuePerTvlPct: 0.46,
    tier: 'yield',
    passed: true,
    rejectedAt: null,
    rejectReason: null,
    ...overrides,
  };
}

describe('SnapshotService', () => {
  const saved: SnapshotRow[][] = [];

  const store = {
    loadSnapshot: jest.fn<Promise<SnapshotRow[] | null>, []>().mockResolvedValue(null),
    saveSnapshot: jest.fn(async (_name: string, rows: SnapshotRow[]) => {
      saved.push(rows);
      return '/tmp/snapshot.json';
    }),
  } as unknown as StoreService;

  const coingecko = {
    getMarketsByIds: jest.fn().mockResolvedValue({
      rows: [
        {
          coingeckoId: 'aave',
          ticker: 'AAVE',
          name: 'Aave',
          priceUsd: 250,
          mcapUsd: 3_700_000_000,
          fdvUsd: 4_000_000_000,
          vol24hUsd: 200_000_000,
          circulating: 15_000_000,
          totalSupply: 16_000_000,
          sourceUrl: 'https://api.coingecko.com/api/v3/coins/markets',
          asOf: '2026-08-24T11:00:00.000Z',
        },
      ],
      errors: [],
    }),
  } as unknown as CoingeckoService;

  const defillama = {
    getProtocols: jest.fn().mockResolvedValue([
      {
        id: '111',
        slug: 'aave-v3',
        name: 'AAVE V3',
        geckoId: 'aave',
        category: 'Lending',
        tvlUsd: 20_000_000_000,
        parentProtocol: null,
      },
    ]),
    getFeesOverview: jest.fn().mockResolvedValue([
      {
        protocolId: '111',
        slug: 'aave-v3',
        name: 'AAVE V3',
        category: 'Lending',
        protocolType: 'protocol',
        latestFetchIsOk: true,
        total30d: 7_500_000,
        total1y: 92_000_000,
      },
    ]),
  } as unknown as DefillamaService;

  const universe = {
    passed: jest.fn().mockResolvedValue([candidate()]),
    latest: jest.fn().mockResolvedValue({ version: '2026-08-24' }),
  } as unknown as UniverseService;

  const service = new SnapshotService(store, defillama, coingecko, universe);

  beforeEach(() => {
    jest.clearAllMocks();
    saved.length = 0;
    (store.loadSnapshot as jest.Mock).mockResolvedValue(null);
    (universe.passed as jest.Mock).mockResolvedValue([candidate()]);
    (universe.latest as jest.Mock).mockResolvedValue({ version: '2026-08-24' });
  });

  it('считает капитализацию кодом и проставляет ссылки на источники', async () => {
    const [row] = await service.build(['aave']);

    expect(row).toMatchObject({
      ticker: 'AAVE',
      sector: 'lending',
      mcapUsd: 3_750_000_000, // price × circulating, а не число CoinGecko
      revenue1y: 92_000_000,
      tvlUsd: 20_000_000_000,
      mcapSource: 'https://api.coingecko.com/api/v3/coins/markets',
      feesSource: 'https://defillama.com/protocol/aave-v3',
      errors: [],
    });
    expect(saved).toHaveLength(1);
  });

  it('берёт время обновления у источника, а не время своего запроса', async () => {
    const [row] = await service.build(['AAVE']);

    expect(row).toMatchObject({ asOfMarket: '2026-08-24T11:00:00.000Z' });
    expect((row as { universeVersion?: string }).universeVersion).toBe('2026-08-24');
  });

  it('не обращается к API в offline-режиме при отсутствии строки', async () => {
    (store.loadSnapshot as jest.Mock).mockResolvedValue([]);

    await expect(service.getRow('AAVE', { offline: true })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(coingecko.getMarketsByIds).not.toHaveBeenCalled();
  });

  it('не подставляет числа при сбое одного источника', async () => {
    (defillama.getFeesOverview as jest.Mock).mockResolvedValueOnce(null);
    const [row] = await service.build(['AAVE']);

    expect(row.revenue1y).toBeNull();
    expect(row.revenue30d).toBeNull();
    expect(row.errors).toContain('DeFiLlama не вернул сводку выручки');
  });

  it('частичный прогон доливается в снапшот, а не затирает вселенную', async () => {
    const previous = [
      { ticker: 'MORPHO', name: 'Morpho' } as SnapshotRow,
      { ticker: 'AAVE', name: 'Старая строка' } as SnapshotRow,
    ];
    (store.loadSnapshot as jest.Mock).mockResolvedValue(previous);

    const rows = await service.build(['AAVE']);

    expect(rows).toHaveLength(1);
    expect(saved[0].map((row) => row.ticker).sort()).toEqual(['AAVE', 'MORPHO']);
    expect(saved[0].find((row) => row.ticker === 'AAVE')?.name).toBe('Aave');
  });

  it('отказывает по токену, отсеянному воронкой вселенной', async () => {
    await expect(service.build(['UNKNOWN'])).rejects.toBeInstanceOf(NotFoundException);
    expect(coingecko.getMarketsByIds).not.toHaveBeenCalled();
  });
});
