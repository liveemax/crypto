import { DEFAULT_PROFILE } from '../src/config/profiles';
import { JobService } from '../src/core/jobs/job.service';
import { StoreService } from '../src/core/store/store.service';
import { UniverseBuilder } from '../src/core/universe/universe.builder';
import { UniverseFilter } from '../src/core/universe/universe.filter';
import { UniverseService } from '../src/core/universe/universe.service';
import type { AnalysisProfile } from '../src/core/universe/profile.types';
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
    tier: 'yield',
    passed: true,
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

/**
 * Секторы разного размера и разной полноты данных: семь конкурентов, четыре
 * конкурента без лидеров у двоих, сектор из двух, сектор из одного, сектор
 * неизвестен, плюс два токена без экономики.
 */
function population(): UniverseCandidate[] {
  return [
    named('DX1', { holderYieldPct: 6, revenue12mUsd: 30_000_000, pRev: 8, revenuePerTvlPct: 3 }),
    named('DX2', { holderYieldPct: 5, revenue12mUsd: 25_000_000, pRev: 10, revenuePerTvlPct: 2.5 }),
    // Лучший балл в секторе, но капитализация ниже абсолютного порога qualify.
    named('DX3', {
      holderYieldPct: 4.5,
      revenue12mUsd: 20_000_000,
      pRev: 9,
      revenuePerTvlPct: 2.8,
      mcapCalcUsd: 20_000_000,
    }),
    named('DX4', { holderYieldPct: 3, revenue12mUsd: 15_000_000, pRev: 14, revenuePerTvlPct: 1.5 }),
    // Выброс выручки к TVL: почти всегда склейка чужих комиссий.
    named('DX5', { holderYieldPct: 2, revenue12mUsd: 10_000_000, pRev: 16, revenuePerTvlPct: 9_000 }),
    // Доходность держателя не измерена: «неизвестно», а не «ноль».
    named('DX6', {
      holderYieldPct: null,
      holdersRevenue12mUsd: null,
      revenue12mUsd: 5_000_000,
      pRev: 18,
      revenuePerTvlPct: 1,
    }),
    named('DX7', { holderYieldPct: 1, revenue12mUsd: 4_000_000, pRev: 20, revenuePerTvlPct: 0.8 }),

    named('LN1', {
      sector: 'lending',
      holdersRevenue12mUsd: null,
      holderYieldPct: null,
      revenue12mUsd: 20_000_000,
      pRev: 10,
      revenuePerTvlPct: 1.2,
    }),
    named('LN2', {
      sector: 'lending',
      holdersRevenue12mUsd: null,
      holderYieldPct: null,
      revenue12mUsd: 12_000_000,
      pRev: 16,
      revenuePerTvlPct: 0.9,
    }),
    named('LN3', {
      sector: 'lending',
      holdersRevenue12mUsd: null,
      holderYieldPct: null,
      revenue12mUsd: 500_000,
      pRev: 400,
      revenuePerTvlPct: 0.1,
    }),
    named('LN4', {
      sector: 'lending',
      holdersRevenue12mUsd: null,
      holderYieldPct: null,
      revenue12mUsd: 400_000,
      pRev: 500,
      revenuePerTvlPct: 0.05,
    }),

    named('YA1', { sector: 'yield-aggregator', revenue12mUsd: 9_000_000, pRev: 22 }),
    named('YA2', { sector: 'yield-aggregator', revenue12mUsd: 8_000_000, pRev: 24 }),
    named('DOM', { sector: 'domains', revenue12mUsd: 7_000_000, pRev: 28 }),
    named('NOSEC', { sector: null, revenue12mUsd: 3_000_000, pRev: 30 }),

    named('BIGPOOL', {
      sector: null,
      matchedBy: 'none',
      defillamaSlugs: [],
      mcapCalcUsd: 900_000_000,
      vol24hUsd: 30_000_000,
      tvlUsd: null,
      fees12mUsd: null,
      revenue12mUsd: null,
      holdersRevenue12mUsd: null,
      holderYieldPct: null,
      pRev: null,
      revenuePerTvlPct: null,
      revenueBasis: 'none',
      revenueSource: null,
    }),
    named('SMALLPOOL', {
      sector: null,
      matchedBy: 'none',
      defillamaSlugs: [],
      mcapCalcUsd: 10_000_000,
      vol24hUsd: 600_000,
      tvlUsd: null,
      fees12mUsd: null,
      revenue12mUsd: null,
      holdersRevenue12mUsd: null,
      holderYieldPct: null,
      pRev: null,
      revenuePerTvlPct: null,
      revenueBasis: 'none',
      revenueSource: null,
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

function withAlpha(patch: Partial<AnalysisProfile['alpha']>): AnalysisProfile {
  return { ...DEFAULT_PROFILE, alpha: { ...DEFAULT_PROFILE.alpha, ...patch } };
}

describe('Приёмка шага 06: альфа по секторам', () => {
  let current: UniverseSnapshot;
  let saved: UniverseSnapshot[];
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

    // Ни одного метода: любое обращение к сети из alpha уронит тест.
    const builder = {} as unknown as UniverseBuilder;
    service = new UniverseService(store, builder, new UniverseFilter(), new JobService());
  });

  it('в секторе не больше perSector лидеров, порядок по sectorScore', async () => {
    const report = await service.alpha();
    const dexs = report.leaders.filter((item) => item.sector === 'dexs');

    expect(dexs).toHaveLength(DEFAULT_PROFILE.alpha.perSector);
    expect(dexs.map((item) => item.ticker)).toEqual(['DX1', 'DX2', 'DX4', 'DX5', 'DX6']);
    expect(dexs[0].sectorScore).toBe(100);
    expect(dexs[0].rankInSector).toBe(1);
    expect(dexs[0].revenueSharePct).toBe(27.52);
    expect(dexs[0].peers).not.toContain('DX1');
    expect(dexs[0].peers).toContain('DX3');
  });

  it('qualify раньше топа: лучший балл без порога лидером не становится', async () => {
    const report = await service.alpha();

    expect(report.leaders.some((item) => item.ticker === 'DX3')).toBe(false);
    // DX3 остаётся конкурентом: перцентили считались вместе с ним.
    expect(report.leaders[0].sectorSize).toBe(7);
    expect(report.leaders[0].qualifiedInSector).toBe(6);
  });

  it('топ не добивается до perSector ради числа', async () => {
    const report = await service.alpha();
    const lending = report.leaders.filter((item) => item.sector === 'lending');

    expect(lending.map((item) => item.ticker)).toEqual(['LN1', 'LN2']);
    expect(lending[0].sectorSize).toBe(4);
  });

  it('сектор меньше minSectorSize лидера не выделяет', async () => {
    const report = await service.alpha();
    const small = report.sectorsWithoutComparison.filter(
      (item) => item.reason === 'too_small',
    );

    expect(small.map((item) => item.sector).sort()).toEqual(['domains', 'yield-aggregator']);
    expect(report.leaders.some((item) => item.sector === 'domains')).toBe(false);
    expect(small.find((item) => item.sector === 'domains')?.members).toHaveLength(1);

    const unknown = report.sectorsWithoutComparison.find(
      (item) => item.reason === 'unknown_sector',
    );
    expect(unknown?.members.map((item) => item.ticker)).toEqual(['NOSEC']);
  });

  it('«неизвестно» не превращается в ноль и не топит участника', async () => {
    const report = await service.alpha();
    const dx6 = report.leaders.find((item) => item.ticker === 'DX6');
    const yieldPct = dx6?.percentiles.find((item) => item.field === 'holderYieldPct');

    expect(yieldPct?.value).toBeNull();
    expect(yieldPct?.percentile).toBeNull();
    expect(yieldPct?.ranked).toBe(6);
    // Балл посчитан по трём доступным перцентилям, а не по нулю за неизвестное.
    expect(dx6?.sectorScore).toBeGreaterThan(0);
  });

  it('выброс выручки к TVL не получает верхний перцентиль', async () => {
    const report = await service.alpha();
    const dx5 = report.leaders.find((item) => item.ticker === 'DX5');
    const perTvl = dx5?.percentiles.find((item) => item.field === 'revenuePerTvlPct');

    expect(perTvl?.value).toBe(9_000);
    expect(perTvl?.percentile).toBeNull();
    expect(dx5?.rankInSector).toBeGreaterThan(1);
    expect(report.warnings.some((line) => line.includes('DX5'))).toBe(true);
  });

  it('тир pool не ранжируется, даже если профиль его просит', async () => {
    service.setActive(withAlpha({ includeTiers: ['yield', 'economics', 'pool'] }));
    const report = await service.alpha();

    expect(report.leaders.every((item) => item.tier !== 'pool')).toBe(true);
    expect(report.warnings.some((line) => line.includes('pool'))).toBe(true);
  });

  it('needsManualData — крупные токены без экономики, а не всё подряд', async () => {
    const report = await service.alpha();
    const tickers = report.needsManualData.map((item) => item.ticker);

    expect(tickers).toEqual(['BIGPOOL']);
    expect(report.needsManualData[0].reason).toContain('не найден');
    expect(tickers).not.toContain('SMALLPOOL');
    expect(report.totals.needsManualData).toBe(1);
  });

  it('смена perSector меняет выдачу без пересборки и без записи на диск', async () => {
    const before = JSON.stringify(current);

    service.setActive(withAlpha({ perSector: 2 }));
    const report = await service.alpha();

    expect(report.leaders.filter((item) => item.sector === 'dexs')).toHaveLength(2);
    expect(report.alpha.perSector).toBe(2);
    expect(report.universeVersion).toBe('2026-08-25');
    expect(JSON.stringify(current)).toBe(before);
    expect(saved).toHaveLength(0);
  });
});