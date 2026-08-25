import { JobService } from '../src/core/jobs/job.service';
import { StoreService } from '../src/core/store/store.service';
import { UniverseBuilder } from '../src/core/universe/universe.builder';
import { UniverseFilter } from '../src/core/universe/universe.filter';
import { UniverseService } from '../src/core/universe/universe.service';
import { UniverseCandidate, UniverseSnapshot } from '../src/core/universe/universe.types';

function candidate(overrides: Partial<UniverseCandidate> = {}): UniverseCandidate {
  return {
    rank: 1,
    coingeckoId: 'aave',
    ticker: 'AAVE',
    name: 'Aave',
    priceUsd: 128.92,
    circulating: 15_000_000,
    totalSupply: 16_000_000,
    mcapCalcUsd: 1_933_800_000,
    mcapReportedUsd: 1_933_800_000,
    mcapDivergencePct: 0,
    fdvUsd: 2_062_000_000,
    vol24hUsd: 438_000_000,
    marketSource: 'https://api.coingecko.com/api/v3/coins/markets',
    marketAsOf: '2026-08-25T10:00:00.000Z',
    turnoverPct: 22.03,
    floatPct: 96.4,
    fdvToMcap: 1.04,
    defillamaSlugs: ['aave-v3'],
    sector: 'lending',
    matchedBy: 'gecko_id',
    tvlUsd: 17_000_000_000,
    tvlSource: 'https://defillama.com/protocol/aave-v3',
    fees12mUsd: 120_000_000,
    revenue12mUsd: 107_000_000,
    holdersRevenue12mUsd: 40_000_000,
    revenue30dUsd: 9_000_000,
    holdersRevenue30dUsd: 3_000_000,
    revenueBasis: 'reported_1y',
    revenueSource: 'https://defillama.com/protocol/aave-v3',
    sourceHealthy: true,
    holderYieldPct: 2.07,
    takeRatePct: 89,
    payoutRatioPct: 37,
    pRev: 18.5,
    pFees: 16.1,
    fdvRev: 19.3,
    revenuePerTvlPct: 0.63,
    tier: 'yield',
    passed: false,
    rejectedAt: null,
    rejectReason: null,
    ...overrides,
  };
}

/**
 * Три кандидата, различающиеся ровно тем, что проверяется:
 * измеренная доходность, измеренный ноль и отсутствие измерения.
 */
function population(): UniverseCandidate[] {
  return [
    candidate(),
    candidate({
      rank: 2,
      coingeckoId: 'zero-yield',
      ticker: 'ZERO',
      name: 'Zero Yield',
      // Доходность измерена и равна нулю: держателю не достаётся ничего.
      holdersRevenue12mUsd: 0,
      holderYieldPct: 0,
      payoutRatioPct: 0,
      pRev: 8,
      takeRatePct: 50,
      tier: 'economics',
    }),
    candidate({
      rank: 3,
      coingeckoId: 'no-data',
      ticker: 'NODATA',
      name: 'No Data',
      // Экономика не измерена вовсе: «неизвестно», а не «ноль».
      defillamaSlugs: [],
      matchedBy: 'none',
      tvlUsd: null,
      tvlSource: null,
      fees12mUsd: null,
      revenue12mUsd: null,
      holdersRevenue12mUsd: null,
      revenue30dUsd: null,
      holdersRevenue30dUsd: null,
      revenueBasis: 'none',
      revenueSource: null,
      holderYieldPct: null,
      takeRatePct: null,
      payoutRatioPct: null,
      pRev: null,
      pFees: null,
      fdvRev: null,
      revenuePerTvlPct: null,
      tier: 'pool',
    }),
  ];
}

function snapshotOf(candidates: UniverseCandidate[]): UniverseSnapshot {
  const funnel = new UniverseFilter().apply(candidates, new Set());
  return {
    version: '2026-08-25',
    builtAt: '2026-08-25T06:00:00.000Z',
    topN: candidates.length,
    sources: {},
    candidates,
    excludedIds: [],
    profileId: 'default',
    funnel,
    warnings: [],
  };
}

describe('Приёмка шага 05: профиль отбора', () => {
  let current: UniverseSnapshot;
  let saved: UniverseSnapshot[];
  let builder: UniverseBuilder;
  let service: UniverseService;

  beforeEach(() => {
    current = snapshotOf(population());
    saved = [];
    const store = {
      loadSnapshot: jest.fn().mockImplementation(async () => current),
      saveSnapshot: jest.fn().mockImplementation(async (_name: string, value: unknown) => {
        saved.push(value as UniverseSnapshot);
        return '/tmp/universe.json';
      }),
    } as unknown as StoreService;

    // Ни одного метода: любое обращение к сети из screen уронит тест.
    builder = {} as unknown as UniverseBuilder;
    service = new UniverseService(store, builder, new UniverseFilter(), new JobService());
  });

  it('default воспроизводит воронку, записанную при сборке', async () => {
    const result = await service.screen({ profileId: 'default' });

    expect(result.profile.id).toBe('default');
    expect(result.funnel.passed).toBe(current.funnel.passed);
    expect(result.funnel.tiers).toEqual(current.funnel.tiers);
  });

  it('разные профили дают разный отбор на одном снимке', async () => {
    const base = await service.screen({ profileId: 'default' });
    const yieldHunter = await service.screen({ profileId: 'yield-hunter' });
    const deepValue = await service.screen({ profileId: 'deep-value' });

    expect(yieldHunter.funnel.passed).not.toBe(base.funnel.passed);
    expect(new Set([base.profile.id, yieldHunter.profile.id, deepValue.profile.id]).size).toBe(3);
  });

  it('отбор не меняет снимок: builtAt тот же, на диск ничего не легло', async () => {
    const before = JSON.stringify(current);

    await service.screen({ profileId: 'yield-hunter' });
    await service.screen({ profileId: 'deep-value' });

    expect(JSON.stringify(current)).toBe(before);
    expect(saved).toHaveLength(0);
  });

  it('повторный отбор тем же профилем даёт тот же результат', async () => {
    const first = await service.screen({ profileId: 'yield-hunter' });
    const second = await service.screen({ profileId: 'yield-hunter' });

    expect(second.funnel).toEqual(first.funnel);
  });

  it('«нет данных» не приравнивается к «ноль»', async () => {
    const result = await service.screen({ profileId: 'yield-hunter' });
    const byId = new Map(result.candidates.map((item) => [item.coingeckoId, item]));

    // Измеренный ноль — отсев по существу.
    expect(byId.get('zero-yield')?.passed).toBe(false);
    expect(byId.get('zero-yield')?.rejectedAt).toBe('holder_yield');

    // Неизмеренная монета остаётся в очереди на ручной сбор данных.
    expect(byId.get('no-data')?.passed).toBe(true);
    expect(byId.get('no-data')?.tier).toBe('pool');
    expect(result.funnel.tiers.pool).toBeGreaterThan(0);
  });

  it('неизвестный профиль отклоняется, а не подменяется базовым', async () => {
    await expect(service.screen({ profileId: 'нет-такого' })).rejects.toThrow();
  });

  it('profileId и profile одновременно — ошибка запроса', async () => {
    const both = { profileId: 'default', profile: { id: 'x' } } as never;
    await expect(service.screen(both)).rejects.toThrow();
  });

  it('пустое тело равносильно базовому профилю', async () => {
    const result = await service.screen({});
    expect(result.profile.id).toBe('default');
  });
});

describe('Одна сетевая задача на процесс', () => {
  it('занятый слот виден всем и освобождается', () => {
    const jobs = new JobService();

    expect(jobs.tryAcquire('universe/refresh')).toBe(true);
    expect(jobs.tryAcquire('universe/prices')).toBe(false);
    expect(() => jobs.acquireOrFail('snapshot/refresh')).toThrow();
    expect(jobs.current?.name).toBe('universe/refresh');

    jobs.release('universe/refresh');
    expect(jobs.current).toBeNull();
    expect(jobs.tryAcquire('snapshot/refresh')).toBe(true);
  });

  it('чужой владелец не может освободить слот', () => {
    const jobs = new JobService();
    jobs.tryAcquire('universe/refresh');
    jobs.release('snapshot/refresh');
    expect(jobs.current?.name).toBe('universe/refresh');
  });
});