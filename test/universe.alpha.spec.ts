import { BadRequestException } from '@nestjs/common';
import { DEFAULT_PROFILE } from '../src/config/profiles';
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
    coingeckoId: 'base',
    ticker: 'BASE',
    name: 'Base Exchange',
    priceUsd: 10,
    circulating: 20_000_000,
    totalSupply: 25_000_000,
    mcapCalcUsd: 200_000_000,
    mcapReportedUsd: 200_000_000,
    mcapDivergencePct: 0,
    fdvUsd: 250_000_000,
    vol24hUsd: 20_000_000,
    turnoverPct: 10,
    floatPct: 80,
    fdvToMcap: 1.25,
    marketSource: 'https://api.coingecko.com/api/v3/coins/markets',
    marketAsOf: '2026-08-25T10:00:00.000Z',
    defillamaSlugs: ['base'],
    sector: 'dexs',
    rawSectors: [],
    comparisonGroup: 'dexs',
    assetArchetype: 'protocol',
    revenueState: 'available',
    matchedBy: 'gecko_id',
    tvlUsd: 1_000_000_000,
    tvlSource: 'https://defillama.com/protocol/base',
    fees12mUsd: 40_000_000,
    revenue12mUsd: 20_000_000,
    holdersRevenue12mUsd: 10_000_000,
    revenue30dUsd: 1_600_000,
    holdersRevenue30dUsd: 800_000,
    revenueBasis: 'reported_1y',
    revenueSource: 'https://defillama.com/protocol/base',
    sourceHealthy: true,
    holderYieldPct: 5,
    takeRatePct: 50,
    payoutRatioPct: 50,
    pRev: 10,
    pFees: 5,
    fdvRev: 12.5,
    revenuePerTvlPct: 2,
    tier: 'pool',
    passed: false,
    rejectedAt: null,
    rejectReason: null,
    ...overrides,
  };
}

function named(ticker: string, overrides: Partial<UniverseCandidate>): UniverseCandidate {
  return candidate({
    coingeckoId: ticker.toLowerCase(),
    ticker,
    name: `${ticker} Exchange`,
    ...overrides,
  });
}

/** Перенасыщенный сектор, два маленьких, один без сектора и один отсеиваемый screen. */
function population(): UniverseCandidate[] {
  return [
    named('DX1', { holderYieldPct: 6, revenue12mUsd: 30_000_000, revenuePerTvlPct: 3, pRev: 8 }),
    named('DX2', { holderYieldPct: 5, revenue12mUsd: 25_000_000, revenuePerTvlPct: 2.5, pRev: 10 }),
    named('DX3', { holderYieldPct: 4, revenue12mUsd: 20_000_000, revenuePerTvlPct: 2, pRev: 12 }),
    named('DX4', { holderYieldPct: 3, revenue12mUsd: 15_000_000, revenuePerTvlPct: 1.5, pRev: 14 }),
    named('DX5', { holderYieldPct: 2, revenue12mUsd: 10_000_000, revenuePerTvlPct: 1, pRev: 16 }),
    named('DX6', { holderYieldPct: 1, revenue12mUsd: 5_000_000, revenuePerTvlPct: 0.5, pRev: 18 }),
    // Известна одна метрика из семи: сравнить не с чем, но это не «худший».
    // Комиссии обнулены намеренно — с ними он стал бы сравнимым, и тест
    // перестал бы проверять то, ради чего написан.
    named('DX7', {
      holderYieldPct: null,
      holdersRevenue12mUsd: null,
      revenue12mUsd: 4_000_000,
      revenuePerTvlPct: null,
      tvlUsd: null,
      pRev: null,
      fees12mUsd: null,
      pFees: null,
    }),
    named('LN1', { sector: 'lending', comparisonGroup: 'lending', revenue12mUsd: 9_000_000, pRev: 22 }),
    named('LN2', { sector: 'lending', comparisonGroup: 'lending', revenue12mUsd: 8_000_000, pRev: 24 }),
    named('DOM', { sector: 'domains', comparisonGroup: 'domains', revenue12mUsd: 7_000_000, pRev: 28 }),
    named('NOSEC', {
      sector: null,
      comparisonGroup: null,
      assetArchetype: 'other',
      revenueState: 'mapping_failed',
      matchedBy: 'none',
      defillamaSlugs: [],
    }),
    // Неликвиден: screen его снимает, альфа при выключенном screen видит.
    named('DEAD', {
      sector: 'domains',
      comparisonGroup: 'domains',
      vol24hUsd: 1_000,
      turnoverPct: 0.0001,
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

describe('Приёмка шага 06: stateful alpha', () => {
  let current: UniverseSnapshot;
  let saved: UniverseSnapshot[];
  let state: { value: unknown };
  let store: StoreService;
  let service: UniverseService;

  function build(): UniverseService {
    return new UniverseService(
      store,
      {} as unknown as UniverseBuilder,
      new UniverseFilter(),
      new JobService(),
      new FilterStateService(store),
    );
  }

  async function tickers(): Promise<string[]> {
    const view = await service.view();
    return view.candidates
      .filter((item) => item.passed)
      .map((item) => item.ticker)
      .sort();
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

  it('режет только перенасыщенный сектор и добавляет стадию в воронку', async () => {
    await service.applyScreen({ enabled: true, profileId: 'default' });
    const before = await service.status();

    const result = await service.applyAlphaFilter({ enabled: true, profileId: 'default' });

    expect(before.passed).toBe(11);
    expect(result.before).toBe(11);
    // Удалён только DX6 — единственный, кто проиграл сравнение. DX7 несравним,
    // NOSEC без группы: оба остаются, оба в dataGaps.
    expect(result.after).toBe(10);
    expect(result.dropped).toBe(1);
    expect(result.funnel.stages.at(-1)?.filter).toBe('alpha');
    expect(result.status.passed).toBe(10);
    expect(result.status.tiers?.rejected).toBe(2);

    const dexs = result.sectors.find((item) => item.sector === 'dexs');
    expect(dexs).toMatchObject({ size: 7, saturated: true, kept: 6, dropped: 1, ranked: 6 });
  });

  it('маленький сектор остаётся целиком, включая сектор из одного', async () => {
    await service.applyScreen({ enabled: true, profileId: 'default' });
    await service.applyAlphaFilter({ enabled: true, profileId: 'default' });
    const view = await service.view();
    const byTicker = new Map(view.candidates.map((item) => [item.ticker, item]));

    expect(byTicker.get('DOM')?.passed).toBe(true);
    expect(byTicker.get('DOM')?.alpha?.decision).toBe('sector_not_saturated');
    expect(byTicker.get('LN1')?.passed).toBe(true);
    expect(byTicker.get('LN2')?.passed).toBe(true);
    expect(view.sectors.find((item) => item.sector === 'domains')?.dropped).toBe(0);
  });

  it('незнание не выдаётся за проигрыш: несравнимый и безгрупповой остаются', async () => {
    await service.applyScreen({ enabled: true, profileId: 'default' });
    const result = await service.applyAlphaFilter({ enabled: true, profileId: 'default' });
    const byTicker = new Map((await service.view()).candidates.map((i) => [i.ticker, i]));

    // Пробел в данных не удаляет токен и не портит его тир.
    expect(byTicker.get('DX7')?.alpha?.decision).toBe('alpha_unrankable');
    expect(byTicker.get('DX7')?.passed).toBe(true);
    expect(byTicker.get('DX7')?.rejectedAt).toBeNull();
    expect(byTicker.get('NOSEC')?.alpha?.decision).toBe('alpha_missing_sector');
    expect(byTicker.get('NOSEC')?.passed).toBe(true);

    // Проигрыш сравнения удаляет и называет причину.
    expect(byTicker.get('DX6')?.alpha?.decision).toBe('alpha_outranked');
    expect(byTicker.get('DX6')?.passed).toBe(false);
    expect(byTicker.get('DX6')?.rejectedAt).toBe('alpha_outranked');

    expect(result.dataGapsTotal).toBe(2);
    const gap = result.dataGaps.find((item) => item.ticker === 'DX7');
    expect(gap?.availableMetrics).toEqual(['revenue12mUsd']);
    expect(gap?.missingMetrics).toContain('holderYieldPct');
  });

  it('работает без screen: вход — весь снимок', async () => {
    const result = await service.applyAlphaFilter({ enabled: true, profileId: 'default' });

    expect(result.activeFilters.screen.enabled).toBe(false);
    expect(result.before).toBe(12);
    expect(result.funnel.stages).toHaveLength(1);
    // DEAD не отсеян screen, а в маленьком секторе альфа его не трогает.
    const byTicker = new Map((await service.view()).candidates.map((i) => [i.ticker, i]));
    expect(byTicker.get('DEAD')?.passed).toBe(true);
  });

  it('порядок вызовов не меняет результат', async () => {
    await service.applyScreen({ enabled: true, profileId: 'default' });
    await service.applyAlphaFilter({ enabled: true, profileId: 'default' });
    const screenFirst = await tickers();

    state.value = null;
    service = build();
    await service.applyAlphaFilter({ enabled: true, profileId: 'default' });
    await service.applyScreen({ enabled: true, profileId: 'default' });
    const alphaFirst = await tickers();

    expect(alphaFirst).toEqual(screenFirst);
  });

  it('выключение возвращает отсеянных и не трогает соседний фильтр', async () => {
    await service.applyScreen({ enabled: true, profileId: 'default' });
    const withoutAlpha = await tickers();

    await service.applyAlphaFilter({ enabled: true, profileId: 'default' });
    const off = await service.applyAlphaFilter({ enabled: false });

    expect(await tickers()).toEqual(withoutAlpha);
    expect(off.activeFilters.screen.enabled).toBe(true);
    expect(off.activeFilters.alpha.config).not.toBeNull();
    expect((await service.view()).candidates.every((item) => item.alpha === null)).toBe(true);
  });

  it('снимок не мутируется, на диск ложится только состояние', async () => {
    const before = JSON.stringify(current);

    await service.applyAlphaFilter({ enabled: true, profileId: 'default' });
    await service.applyAlphaFilter({ enabled: false });

    expect(JSON.stringify(current)).toBe(before);
    expect(saved).toHaveLength(0);
  });

  it('разовая конфигурация меняет выдачу, противоречивое тело — 400', async () => {
    await service.applyScreen({ enabled: true, profileId: 'default' });
    const narrow = await service.applyAlphaFilter({
      enabled: true,
      alpha: { ...DEFAULT_PROFILE.alpha, perSector: 3 },
    });

    // Три места в топе плюс несравнимый DX7, которого альфа не трогает.
    const view = await service.view();
    const top = view.candidates.filter((i) => i.alpha?.decision === 'kept_top_n');
    expect(top).toHaveLength(3);
    expect(narrow.sectors.find((item) => item.sector === 'dexs')?.kept).toBe(4);
    expect(narrow.activeFilters.alpha.profileId).toBeNull();

    await expect(
      service.applyAlphaFilter({ enabled: false, profileId: 'default' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.applyAlphaFilter({ enabled: true, alpha: { ...DEFAULT_PROFILE.alpha, minScoreMetrics: 9 } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});