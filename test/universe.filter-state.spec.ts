import { BadRequestException } from '@nestjs/common';
import { JobService } from '../src/core/jobs/job.service';
import { StoreService } from '../src/core/store/store.service';
import { FilterStateService } from '../src/core/universe/filter-state.service';
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
    turnoverPct: 22.03,
    floatPct: 96.4,
    fdvToMcap: 1.04,
    marketSource: 'https://api.coingecko.com/api/v3/coins/markets',
    marketAsOf: '2026-08-25T10:00:00.000Z',
    defillamaSlugs: ['aave-v3'],
    sector: 'lending',
    rawSectors: [],
    comparisonGroup: 'lending',
    assetArchetype: 'protocol',
    revenueState: 'available',
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
    // Флаги из прошлой сборки нарочно неверные: они обязаны пересчитываться,
    // а не читаться. Файл фактов не хранит ничьё мнение.
    tier: 'rejected',
    passed: false,
    rejectedAt: 'stale',
    rejectReason: 'мнение прошлой сборки',
    ...overrides,
  };
}

/** Четыре кандидата: доходный, с измеренным нулём, неликвидный и без данных. */
function population(): UniverseCandidate[] {
  return [
    candidate(),
    candidate({
      rank: 2,
      coingeckoId: 'zero-yield',
      ticker: 'ZERO',
      name: 'Zero Yield',
      holdersRevenue12mUsd: 0,
      holderYieldPct: 0,
      payoutRatioPct: 0,
    }),
    candidate({
      rank: 3,
      coingeckoId: 'dead-token',
      ticker: 'DEAD',
      name: 'Dead Token',
      vol24hUsd: 1_000,
      turnoverPct: 0.0001,
      fees12mUsd: null,
      revenue12mUsd: null,
      holdersRevenue12mUsd: null,
      holderYieldPct: null,
      payoutRatioPct: null,
      pRev: null,
    }),
    candidate({
      rank: 4,
      coingeckoId: 'no-data',
      ticker: 'NODATA',
      name: 'No Data',
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
    }),
  ];
}

function snapshotOf(candidates: UniverseCandidate[]): UniverseSnapshot {
  return {
    version: '2026-08-25',
    builtAt: '2026-08-25T06:00:00.000Z',
    topN: candidates.length,
    sources: {},
    candidates,
    excludedIds: [],
    warnings: [],
  };
}

describe('Приёмка шага 05: состояние фильтров', () => {
  let current: UniverseSnapshot;
  let saved: UniverseSnapshot[];
  let state: { value: unknown };
  let store: StoreService;
  let service: UniverseService;

  function build(): UniverseService {
    // Ни одного метода у билдера: любое обращение к сети уронит тест.
    const builder = {} as unknown as UniverseBuilder;
    return new UniverseService(
      store,
      builder,
      new UniverseFilter(),
      new JobService(),
      new FilterStateService(store),
    );
  }

  beforeEach(() => {
    current = snapshotOf(population());
    saved = [];
    state = { value: null };
    store = {
      loadSnapshot: jest.fn().mockImplementation(async () => current),
      saveSnapshot: jest.fn().mockImplementation(async (_name: string, value: unknown) => {
        saved.push(value as UniverseSnapshot);
        return '/tmp/universe.json';
      }),
      loadState: jest.fn().mockImplementation(async () => state.value ?? null),
      saveState: jest.fn().mockImplementation(async (_name: string, value: unknown) => {
        state.value = value;
        return '/tmp/active-filters.json';
      }),
    } as unknown as StoreService;
    service = build();
  });

  it('без фильтров вселенная отдаётся целиком, воронка пуста', async () => {
    const status = await service.status();

    expect(status.total).toBe(4);
    expect(status.passed).toBe(4);
    expect(status.tiers).toEqual({ yield: 1, economics: 1, pool: 2, rejected: 0 });
    expect(status.activeFilters.screen.enabled).toBe(false);
    expect((await service.view()).funnel.stages).toEqual([]);
  });

  it('включение фильтра отсеивает и называет виновника каждой стадии', async () => {
    const result = await service.applyScreen({ enabled: true, profileId: 'default' });

    expect(result.before).toBe(4);
    expect(result.after).toBe(3);
    expect(result.funnel.stages.every((stage) => stage.filter === 'screen')).toBe(true);

    const view = await service.view();
    const dead = view.candidates.find((item) => item.ticker === 'DEAD');
    expect(dead?.passed).toBe(false);
    expect(dead?.rejectedAt).toBe('liquid');
    expect(dead?.rejectReason).toContain('позиции');
  });

  it('выключение возвращает точно прежний состав и не стирает конфигурацию', async () => {
    const before = (await service.view()).candidates.map((item) => item.ticker).sort();

    await service.applyScreen({ enabled: true, profileId: 'yield-hunter' });
    expect((await service.status()).passed).toBe(2);

    const off = await service.applyScreen({ enabled: false });
    const after = (await service.view()).candidates.map((item) => item.ticker).sort();

    expect(off.after).toBe(4);
    expect(after).toEqual(before);
    // Конфигурация пережила выключение: включить обратно — один вызов без тела.
    expect(off.activeFilters.screen.profileId).toBe('yield-hunter');

    const again = await service.applyScreen({ enabled: true });
    expect(again.activeFilters.screen.profileId).toBe('yield-hunter');
    expect(again.after).toBe(2);
  });

  it('«неизвестно» не приравнивается к «ноль»', async () => {
    await service.applyScreen({ enabled: true, profileId: 'yield-hunter' });
    const byId = new Map((await service.view()).candidates.map((i) => [i.coingeckoId, i]));

    // Измеренный ноль — отсев по существу.
    expect(byId.get('zero-yield')?.passed).toBe(false);
    expect(byId.get('zero-yield')?.rejectedAt).toBe('holder_yield');
    // Неизмеренная монета остаётся: её просто не мерили.
    expect(byId.get('no-data')?.passed).toBe(true);
    expect(byId.get('no-data')?.tier).toBe('pool');
  });

  it('состояние переживает перезапуск процесса', async () => {
    await service.applyScreen({ enabled: true, profileId: 'deep-value' });
    const expected = await service.status();

    const restarted = build();
    const actual = await restarted.status();

    expect(actual.passed).toBe(expected.passed);
    expect(actual.activeFilters).toEqual(expected.activeFilters);
    expect(actual.profileId).toBe('deep-value');
  });

  it('снимок не мутируется, на диск ложится только состояние', async () => {
    const before = JSON.stringify(current);

    await service.applyScreen({ enabled: true, profileId: 'default' });
    await service.applyScreen({ enabled: false });

    expect(JSON.stringify(current)).toBe(before);
    expect(saved).toHaveLength(0);
    expect(store.saveState).toHaveBeenCalledTimes(2);
  });

  it('отвергает противоречивое тело', async () => {
    await expect(
      service.applyScreen({ enabled: false, profileId: 'default' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.applyScreen({ enabled: true, profileId: 'unknown' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Состояние не изменилось ни одной неудачной попыткой.
    expect((await service.status()).activeFilters.screen.enabled).toBe(false);
  });
});