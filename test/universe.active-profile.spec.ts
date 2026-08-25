import { NotFoundException } from '@nestjs/common';
import { UniverseController } from '../src/core/universe/universe.controller';
import { UniverseService } from '../src/core/universe/universe.service';
import { UniverseFilter } from '../src/core/universe/universe.filter';
import { UniverseBuilder } from '../src/core/universe/universe.builder';
import { JobService } from '../src/core/jobs/job.service';
import { StoreService } from '../src/core/store/store.service';
import { UniverseCandidate, UniverseSnapshot } from '../src/core/universe/universe.types';

function candidate(overrides: Partial<UniverseCandidate> = {}): UniverseCandidate {
  return {
    rank: 1,
    coingeckoId: 'aave',
    ticker: 'AAVE',
    name: 'Aave',
    priceUsd: 100,
    circulating: 20_000_000,
    totalSupply: 20_000_000,
    mcapCalcUsd: 2_000_000_000,
    mcapReportedUsd: 2_000_000_000,
    mcapDivergencePct: 0,
    fdvUsd: 2_000_000_000,
    vol24hUsd: 400_000_000,
    marketSource: 'https://api.coingecko.com/api/v3/coins/markets',
    marketAsOf: '2026-08-25T10:00:00.000Z',
    turnoverPct: 20,
    floatPct: 100,
    fdvToMcap: 1,
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
    holderYieldPct: 2,
    takeRatePct: 89,
    payoutRatioPct: 37,
    pRev: 18.7,
    pFees: 16.7,
    fdvRev: 18.7,
    revenuePerTvlPct: 0.63,
    tier: 'yield',
    passed: false,
    rejectedAt: null,
    rejectReason: null,
    ...overrides,
  };
}

/**
 * Две монеты, различающиеся ровно тем, что делит default и deep-value:
 * дороговизна к выручке и доля эмиссии в обращении.
 */
function population(): UniverseCandidate[] {
  return [
    // Проходит оба отбора: дёшева и вся эмиссия в обращении.
    candidate({ pRev: 8, takeRatePct: 50, floatPct: 100 }),
    // Проходит default, но не deep-value: P/Rev выше 15 и float ниже 30%.
    candidate({
      rank: 2,
      coingeckoId: 'expensive',
      ticker: 'EXP',
      name: 'Expensive',
      pRev: 90,
      takeRatePct: 4,
      floatPct: 20,
      circulating: 2_000_000,
      totalSupply: 10_000_000,
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
    profileId: 'default',
    funnel: new UniverseFilter().apply(candidates, new Set()),
    warnings: [],
  };
}

describe('Рабочий отбор', () => {
  let snapshot: UniverseSnapshot | null;
  let service: UniverseService;
  let controller: UniverseController;

  beforeEach(() => {
    snapshot = snapshotOf(population());
    const store = {
      loadSnapshot: jest.fn().mockImplementation(async () => snapshot),
      saveSnapshot: jest.fn(),
    } as unknown as StoreService;

    service = new UniverseService(
      store,
      {} as unknown as UniverseBuilder,
      new UniverseFilter(),
      new JobService(),
    );
    controller = new UniverseController(service);
  });

  it('до первого screen рабочий отбор — базовый', async () => {
    const status = await controller.status();
    expect(status.profileId).toBe('default');
  });

  it('screen делает выбранный отбор рабочим для status и funnel', async () => {
    const screened = await controller.screen({ profileId: 'deep-value' });
    const status = await controller.status();
    const funnel = await controller.funnel();

    expect(status.profileId).toBe('deep-value');
    expect(funnel.profileId).toBe('deep-value');
    // Одно и то же число во всех трёх ответах: именно его расхождение
    // заставляло искать несуществующий баг.
    expect(status.passed).toBe(screened.funnel.passed);
    expect(funnel.passed).toBe(screened.funnel.passed);
  });

  it('deep-value отсеивает больше базового на тех же данных', async () => {
    const base = await controller.screen({ profileId: 'default' });
    const strict = await controller.screen({ profileId: 'deep-value' });

    expect(strict.funnel.passed).toBeLessThan(base.funnel.passed);
  });

  it('profileId в запросе смотрит разово и рабочий отбор не сбивает', async () => {
    await controller.screen({ profileId: 'deep-value' });

    const peek = await controller.funnel('default');
    expect(peek.profileId).toBe('default');

    const status = await controller.status();
    expect(status.profileId).toBe('deep-value');
  });

  it('воронка называет снимок и отбор, из которых получена', async () => {
    const funnel = await controller.funnel();

    expect(funnel.universeVersion).toBe('2026-08-25');
    expect(funnel.builtAt).toBe('2026-08-25T06:00:00.000Z');
    expect(funnel.profileId).toBeTruthy();
  });

  it('список монет считается рабочим отбором', async () => {
    await controller.screen({ profileId: 'deep-value' });
    const strict = await controller.list({});

    await controller.screen({ profileId: 'default' });
    const base = await controller.list({});

    expect(base.length).toBeGreaterThan(strict.length);
  });

  it('список отдаётся страницами, а не целиком', async () => {
    const page = await controller.list({ limit: 1, passedOnly: false });
    expect(page).toHaveLength(1);
  });

  it('screen не отдаёт монеты, пока их не попросили', async () => {
    const quiet = await controller.screen({ profileId: 'default' });
    expect(quiet.candidates).toHaveLength(0);

    const loud = await controller.screen({ profileId: 'default' }, 'true', '1');
    expect(loud.candidates).toHaveLength(1);
  });

  it('без собранной вселенной — понятный отказ, а не пустой ответ', async () => {
    snapshot = null;
    await expect(controller.funnel()).rejects.toThrow(NotFoundException);
    await expect(controller.list({})).rejects.toThrow(NotFoundException);
  });
});