import { BadRequestException } from '@nestjs/common';
import { DEFAULT_PROFILE } from '../../config/profiles';
import { StoreService } from '../store/store.service';
import { UniverseBuilder } from './universe.builder';
import { UniverseFilter } from './universe.filter';
import { UniverseService } from './universe.service';
import { UniverseCandidate, UniverseSnapshot } from './universe.types';
import { JobService } from '../jobs/job.service';

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
    mcapReportedUsd: 3_750_000_000,
    mcapDivergencePct: 0,
    fdvUsd: 4_000_000_000,
    vol24hUsd: 200_000_000,
    turnoverPct: 5.33,
    floatPct: 93.75,
    fdvToMcap: 1.07,
    marketSource: 'https://api.coingecko.com/api/v3/coins/markets',
    marketAsOf: '2026-08-24T11:00:00.000Z',
    defillamaSlugs: ['aave-v3'],
    sector: 'lending',
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
    tier: 'yield',
    passed: true,
    rejectedAt: null,
    rejectReason: null,
    ...overrides,
  };
}

function snapshot(): UniverseSnapshot {
  const candidates = [
    candidate(),
    candidate({
      rank: 2,
      coingeckoId: 'value-token',
      ticker: 'VALUE',
      holdersRevenue12mUsd: 0,
      holderYieldPct: 0,
      payoutRatioPct: 0,
      pRev: 10,
      takeRatePct: 20,
      floatPct: 50,
      tier: 'economics',
    }),
  ];
  const filter = new UniverseFilter();
  const funnel = filter.apply(candidates, new Set(), DEFAULT_PROFILE);
  return {
    version: '2026-08-24',
    builtAt: '2026-08-24T12:00:00.000Z',
    topN: 2,
    sources: {},
    candidates,
    excludedIds: [],
    profileId: 'default',
    funnel,
    warnings: [],
  };
}

describe('UniverseService profiles', () => {
  let current: UniverseSnapshot;
  let saved: UniverseSnapshot[];
  let store: StoreService;
  let builder: UniverseBuilder;
  let service: UniverseService;

  beforeEach(() => {
    current = snapshot();
    saved = [];
    store = {
      loadSnapshot: jest.fn().mockImplementation(async () => current),
      saveSnapshot: jest.fn().mockImplementation(async (_name: string, value: unknown) => {
        saved.push(value as UniverseSnapshot);
        return '/tmp/universe.json';
      }),
    } as unknown as StoreService;
    builder = {
      refreshNumbers: jest.fn().mockImplementation(
        async (candidates: readonly UniverseCandidate[]) => ({
          candidates: candidates.map((item) => ({ ...item })),
          sources: { markets: 'https://api.coingecko.com/api/v3/coins/markets' },
          warnings: [],
        }),
      ),
    } as unknown as UniverseBuilder;    
    service = new UniverseService(store, builder, new UniverseFilter(), new JobService());
  });

  it('применяет два профиля без сети и не мутирует сохранённый снимок', async () => {
    const before = JSON.stringify(current);

    const base = await service.screen({ profileId: 'default' });
    const yieldOnly = await service.screen({ profileId: 'yield-hunter' });

    expect(base.funnel.passed).toBe(2);
    expect(yieldOnly.funnel.passed).toBe(1);
    expect(yieldOnly.candidates[1].rejectedAt).toBe('holder_yield');
    expect(JSON.stringify(current)).toBe(before);
    expect(builder.refreshNumbers).not.toHaveBeenCalled();
    expect(store.saveSnapshot).not.toHaveBeenCalled();
  });

  it('сравнивает профили и показывает участников и смену тиров', async () => {
    const result = await service.compare('yield-hunter', 'deep-value');

    expect(result.onlyLeft.map((item) => item.ticker)).toEqual(['AAVE']);
    expect(result.onlyRight.map((item) => item.ticker)).toEqual(['VALUE']);
    expect(result.tierChanges).toHaveLength(2);
  });

  it('отказывает при неизвестном профиле', async () => {
    await expect(service.screen({ profileId: 'unknown' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(builder.refreshNumbers).not.toHaveBeenCalled();
  });

  it('обновляет числа в фоне, не трогая состав и дату сборки', async () => {
    const builtAtBefore = current.builtAt;
    const versionBefore = current.version;

    const started = await service.refreshPrices();
    expect(started.started).toBe(true);
    await service.wait();

    expect(saved).toHaveLength(1);
    const [snapshot] = saved;
    expect(snapshot.builtAt).toBe(builtAtBefore);
    expect(snapshot.version).toBe(versionBefore);
    expect(snapshot.profileId).toBe('default');
    expect(snapshot.candidates).toHaveLength(current.candidates.length);
  });
});
