import { DEEP_VALUE_PROFILE, DEFAULT_PROFILE } from '../src/config/profiles';
import { EvaluationService } from '../src/core/evaluation/evaluation.service';
import type { EvaluationRun } from '../src/core/evaluation/evaluation.types';
import { JobService } from '../src/core/jobs/job.service';
import { StoreService } from '../src/core/store/store.service';
import { EMPTY_TOKENOMICS } from '../src/core/tokenomics/tokenomics.constants';
import { FilterStateService } from '../src/core/universe/filter-state.service';
import { UniverseBuilder } from '../src/core/universe/universe.builder';
import { UniverseFilter } from '../src/core/universe/universe.filter';
import { UniverseService } from '../src/core/universe/universe.service';
import type { UniverseCandidate, UniverseSnapshot } from '../src/core/universe/universe.types';

const NOW = new Date().toISOString();

function candidate(overrides: Partial<UniverseCandidate> = {}): UniverseCandidate {
  return {
    ...EMPTY_TOKENOMICS,
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
    marketAsOf: NOW,
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
    tier: 'yield',
    passed: false,
    rejectedAt: null,
    rejectReason: null,
    ...overrides,
  };
}

function named(ticker: string, overrides: Partial<UniverseCandidate> = {}): UniverseCandidate {
  return candidate({
    coingeckoId: ticker.toLowerCase(),
    ticker,
    name: `${ticker} Exchange`,
    ...overrides,
  });
}

/**
 * Девять строк одной ниши. Навес задаётся явно: это хранимое поле шага 09,
 * из circulating и totalSupply оценка его не пересчитывает. Значения различны,
 * чтобы перцентиль был измерением, а не жеребьёвкой.
 */
function population(): UniverseCandidate[] {
  return [
    named('DX1', { pRev: 4, holderYieldPct: 9, revenue12mUsd: 60_000_000, overhangPct: 10 }),
    named('DX2', { pRev: 6, holderYieldPct: 7, revenue12mUsd: 40_000_000, overhangPct: 20 }),
    named('DX3', { pRev: 8, holderYieldPct: 5, revenue12mUsd: 30_000_000, overhangPct: 30 }),
    named('DX4', { pRev: 12, holderYieldPct: 3, revenue12mUsd: 20_000_000, overhangPct: 40 }),
    // Подтверждённый календарь и отрицательный NHY: хард-фильтр обязан сработать.
    named('NEG', {
      pRev: 9,
      holderYieldPct: 2,
      overhangPct: 50,
      unlock12mPct: 20,
      netHolderYieldPct: -18,
      tokenomicsState: 'available',
      tokenomicsSource: 'https://defillama.com/unlocks/neg',
      asOfTokenomics: NOW,
    }),
    // Календаря нет, навес есть: балл ставится по нише, хард-фильтра быть не может.
    named('UNK', {
      pRev: 11,
      holderYieldPct: 4,
      overhangPct: 60,
      tokenomicsState: 'source_missing',
    }),
    // Навес ноль при календаре на 20%: источники считают эмиссию по-разному.
    named('CONTRA', {
      pRev: 7,
      holderYieldPct: 2,
      overhangPct: 0,
      unlock12mPct: 20,
      netHolderYieldPct: -18,
      tokenomicsState: 'available',
      tokenomicsSource: 'https://defillama.com/unlocks/contra',
      asOfTokenomics: NOW,
    }),
    // Числа есть, ссылки нет: валидатор обязан обнулить метрики в ответе.
    // Сами поля кандидата при этом остаются, и перцентили считаются по ним.
    named('NOSRC', { revenueSource: null, tvlSource: null, overhangPct: 70 }),
    // Экономики нет вовсе: место в нише должно взяться с одной оси предложения.
    named('POOL', {
      overhangPct: 80,
      tvlUsd: null,
      fees12mUsd: null,
      revenue12mUsd: null,
      holdersRevenue12mUsd: null,
      revenue30dUsd: null,
      holdersRevenue30dUsd: null,
      revenueBasis: 'none',
      revenueState: 'source_missing',
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
  return {
    version: '2026-08-26',
    builtAt: '2026-08-26T06:00:00.000Z',
    topN: candidates.length,
    sources: {},
    candidates,
    excludedIds: [],
    warnings: [],
  };
}

describe('Приёмка шага 10: массовая кодовая оценка', () => {
  let snapshot: UniverseSnapshot;
  let filterState: { value: unknown };
  let runs: EvaluationRun[];
  let store: StoreService;
  let universe: UniverseService;
  let service: EvaluationService;

  beforeEach(() => {
    snapshot = snapshotOf(population());
    filterState = { value: null };
    runs = [];
    store = {
      loadSnapshot: jest.fn(async () => snapshot),
      saveSnapshot: jest.fn(async () => '/tmp/universe.json'),
      loadState: jest.fn(async () => filterState.value ?? null),
      saveState: jest.fn(async (_name: string, value: unknown) => {
        filterState.value = value;
        return '/tmp/active-filters.json';
      }),
      saveRun: jest.fn(async (_kind: string, _runId: string, value: unknown) => {
        runs.push(value as EvaluationRun);
        return '/tmp/run.json';
      }),
      loadRun: jest.fn(async () => runs.at(-1) ?? null),
    } as unknown as StoreService;

    universe = new UniverseService(
      store,
      {} as unknown as UniverseBuilder,
      new UniverseFilter(),
      new JobService(),
      new FilterStateService(store),
    );
    service = new EvaluationService(store, universe);
  });

  it('один POST создаёт три компонента ровно по составу выборки', async () => {
    const status = await universe.status();
    const result = await service.run();

    expect(result.evaluatedCount).toBe(status.passed);
    const run = runs.at(-1) as EvaluationRun;
    expect(run.candidates.every((item) => item.valuation && item.tokenomics && item.sectorPosition)).toBe(true);
    expect(result.context.universeVersion).toBe('2026-08-26');
    expect(result.pagination.total).toBe(status.passed);
  });

  it('работают все четыре комбинации фильтров, состав меняют только они', async () => {
    const none = await service.run();

    await universe.applyScreen({ enabled: true, profileId: 'default' });
    const screenOnly = await service.run({ refresh: true });

    await universe.applyAlphaFilter({ enabled: true, profileId: 'default' });
    const both = await service.run({ refresh: true });

    await universe.applyScreen({ enabled: false });
    const alphaOnly = await service.run({ refresh: true });

    for (const result of [none, screenOnly, both, alphaOnly]) {
      expect(result.evaluatedCount).toBeGreaterThan(0);
      expect(result.evaluatedCount).toBe(result.pagination.total);
    }
    // Оценка не трогает состояние фильтров ни в одной комбинации.
    expect((await universe.status()).activeFilters.screen.enabled).toBe(false);
  });

  it('alpha выключена — sectorPosition всё равно считается', async () => {
    await universe.applyScreen({ enabled: true, profileId: 'default' });
    const result = await service.run();
    const run = runs.at(-1) as EvaluationRun;
    const dx1 = run.candidates.find((item) => item.ticker === 'DX1');

    expect(result.context.activeFilters.alpha.enabled).toBe(false);
    expect(dx1?.sectorPosition.score).not.toBeNull();
    expect(dx1?.sectorPosition.verdict.selectionApplied).toBe(false);
    expect(dx1?.sectorPosition.verdict.rankInSector).toBe(1);
  });

  it('смена только alpha пересчитывает sectorPosition и переиспользует остальное', async () => {
    await universe.applyScreen({ enabled: true, profileId: 'default' });
    await service.run();

    await universe.applyAlphaFilter({ enabled: true, profileId: 'default' });
    const second = await service.run();

    expect(second.reuse.perToken).toBe(true);
    expect(second.reuse.comparative).toBe(false);
    expect(second.reuse.recomputedTokens).toBe(0);
    expect(second.reuse.recomputedSectorPosition).toBeGreaterThan(0);
  });

  it('подтверждённый отрицательный NHY даёт hardFilterFail, неизвестный календарь — нет', async () => {
    await service.run();
    const run = runs.at(-1) as EvaluationRun;

    const negative = run.candidates.find((item) => item.ticker === 'NEG');
    const unknown = run.candidates.find((item) => item.ticker === 'UNK');

    expect(negative?.tokenomics.verdict.hardFilterFail).toBe(true);
    expect(negative?.tokenomics.verdict.dilutionRisk).toBe('high');
    expect(unknown?.tokenomics.verdict.hardFilterFail).toBe(false);
    expect(unknown?.tokenomics.verdict.dilutionRisk).toBe('unknown');
    // Календаря нет, но навес известен: балл ставится по нему, а не пропускается.
    expect(unknown?.tokenomics.score).not.toBeNull();
    expect(unknown?.tokenomics.verdict.basis).toBe('absolute_overhang');
  });

  it('НЕГАТИВНЫЙ: разлок выше навеса снимает хард-фильтр, а не подтверждает его', async () => {
    await service.run();
    const run = runs.at(-1) as EvaluationRun;
    const contra = run.candidates.find((item) => item.ticker === 'CONTRA');

    expect(contra?.tokenomics.verdict.sourcesDisagree).toBe(true);
    expect(contra?.tokenomics.verdict.hardFilterFail).toBe(false);
    expect(contra?.tokenomics.notes).toContain('источники считают эмиссию по-разному');
  });

  it('покрытие tokenomics и sectorPosition — по навесу, а не по выручке', async () => {
    const result = await service.run();
    const run = runs.at(-1) as EvaluationRun;
    const total = run.candidates.length;

    // Навес известен у всех фикстур, значит балл есть у всех.
    expect(result.summaries.tokenomics.scored).toBe(total);
    expect(result.summaries.sectorPosition.scored).toBeLessThan(total);
    // Дешевизна остаётся на потолке покрытия выручки: её поднять нечем.
    expect(result.summaries.valuation.scored).toBeLessThan(total);
  });

  it('токен без одной business scale оси остаётся data gap' , async () => {
    await service.run();
    const run = runs.at(-1) as EvaluationRun;
    const pool = run.candidates.find((item) => item.ticker === 'POOL');

    expect(pool?.sectorPosition.score).toBeNull();
    expect(pool?.sectorPosition.verdict.role).toBe('unknown');
    expect(pool?.sectorPosition.verdict.businessScaleScore).toBeNull();
  });

  it('НЕГАТИВНЫЙ: метрика без источника обнуляется, качество падает, поле уходит в missing', async () => {
    await service.run();
    const run = runs.at(-1) as EvaluationRun;
    const broken = run.candidates.find((item) => item.ticker === 'NOSRC');
    const healthy = run.candidates.find((item) => item.ticker === 'DX1');

    expect(broken?.valuation.metrics.revenue12mUsd).toMatchObject({
      value: null,
      droppedReason: 'no_source',
    });
    expect(broken?.valuation.missing).toEqual(expect.arrayContaining(['revenue12mUsd', 'pRev']));
    expect(broken?.valuation.dataQuality).toBeLessThan(healthy?.valuation.dataQuality ?? 1);
    expect(broken?.valuation.score).toBeNull();
    expect(broken?.valuation.scoreRaw).toBeUndefined();
  });

  it('ШАГ 12.2: дешёвый меньший бизнес выигрывает sector valuation, а provenance и гейт защищают score', async () => {
    snapshot = snapshotOf([
      named('LARGE', { tvlUsd: 3_000_000_000, revenue12mUsd: 300_000_000, pRev: 30, pFees: 20, fdvRev: 35, holderYieldPct: 1, revenuePerTvlPct: 10 }),
      named('CHEAP', { tvlUsd: 1_000_000_000, revenue12mUsd: 100_000_000, pRev: 3, pFees: 2, fdvRev: 4, holderYieldPct: 8, revenuePerTvlPct: 10 }),
      named('MID', { tvlUsd: 2_000_000_000, revenue12mUsd: 200_000_000, pRev: 12, pFees: 8, fdvRev: 15, holderYieldPct: 4, revenuePerTvlPct: 10 }),
      named('NOSRC', { revenueSource: null, tvlSource: null, pRev: 1, pFees: 1, fdvRev: 1, holderYieldPct: 20, revenuePerTvlPct: 20 }),
      named('ONE', { pFees: null, fdvRev: null, holderYieldPct: null, revenuePerTvlPct: null }),
    ]);

    await service.run({ refresh: true });
    const run = runs.at(-1) as EvaluationRun;
    const large = run.candidates.find((item) => item.ticker === 'LARGE')!;
    const cheap = run.candidates.find((item) => item.ticker === 'CHEAP')!;
    const noSource = run.candidates.find((item) => item.ticker === 'NOSRC')!;
    const one = run.candidates.find((item) => item.ticker === 'ONE')!;

    expect(large.sectorPosition.verdict.rankInSector).toBe(1);
    expect(cheap.valuation.verdict.valuationRank).toBe(1);
    expect(cheap.valuation.score).toBeGreaterThan(large.valuation.score ?? 100);
    expect(cheap.valuation.verdict).toMatchObject({
      availableMetrics: ['pRev', 'pFees', 'fdvRev', 'holderYieldPct', 'revenuePerTvlPct'],
      availableWeight: 1,
      formulaVersion: 'sector-valuation-v1',
    });
    expect(noSource.valuation.score).toBeNull();
    expect(noSource.valuation.verdict.availableMetrics).toEqual([]);
    expect(one.valuation.score).toBeNull();
    expect(one.valuation.verdict.availableWeight).toBe(0.4);
    expect(one.valuation.missing).toEqual(expect.arrayContaining(['pFees', 'fdvRev', 'holderYieldPct', 'revenuePerTvlPct']));
  });

  it('ШАГ 12.2 НЕГАТИВНЫЙ: два подтверждённых значения не образуют valuation percentile', async () => {
    snapshot = snapshotOf([
      named('PAIR1', { comparisonGroup: 'pair', pRev: 4 }),
      named('PAIR2', { comparisonGroup: 'pair', pRev: 8 }),
    ]);

    await service.run({ refresh: true });
    const run = runs.at(-1) as EvaluationRun;
    for (const item of run.candidates) {
      expect(item.valuation.score).toBeNull();
      expect(item.valuation.verdict.percentiles).toMatchObject({ pRev: null, pFees: null });
      expect(item.valuation.verdict.availableWeight).toBe(0);
    }
  });

  it('ШАГ 12.2: одинаковый score из разного числа осей различим по metadata', async () => {
    snapshot = snapshotOf([
      named('TWO', { pRev: 10, pFees: null, fdvRev: 12, holderYieldPct: null, revenuePerTvlPct: null }),
      named('THREE1', { pRev: 10, pFees: 5, fdvRev: 12, holderYieldPct: null, revenuePerTvlPct: null }),
      named('THREE2', { pRev: 10, pFees: 5, fdvRev: 12, holderYieldPct: null, revenuePerTvlPct: null }),
      named('THREE3', { pRev: 10, pFees: 5, fdvRev: 12, holderYieldPct: null, revenuePerTvlPct: null }),
    ]);

    await service.run({ refresh: true });
    const run = runs.at(-1) as EvaluationRun;
    const twoAxes = run.candidates.find((item) => item.ticker === 'TWO')!;
    const threeAxes = run.candidates.find((item) => item.ticker === 'THREE1')!;

    expect(twoAxes.valuation.score).toBe(threeAxes.valuation.score);
    expect(twoAxes.valuation.verdict).toMatchObject({
      availableMetrics: ['pRev', 'fdvRev'],
      availableWeight: 0.6,
    });
    expect(threeAxes.valuation.verdict).toMatchObject({
      availableMetrics: ['pRev', 'pFees', 'fdvRev'],
      availableWeight: 0.8,
    });
  });

  it('appliedBy различает проверку screen и проверку оценки', async () => {
    await universe.applyScreen({ enabled: true, profileId: 'deep-value' });
    await service.run({ profileId: 'deep-value' });
    const withScreen = runs.at(-1) as EvaluationRun;
    const byScreen = withScreen.candidates
      .find((item) => item.ticker === 'DX1')
      ?.valuation.verdict.checks as { id: string; appliedBy: string }[];

    await universe.applyScreen({ enabled: false });
    await service.run({ profileId: 'deep-value', refresh: true });
    const withoutScreen = runs.at(-1) as EvaluationRun;
    const byEvaluation = withoutScreen.candidates
      .find((item) => item.ticker === 'DX1')
      ?.valuation.verdict.checks as { id: string; appliedBy: string }[];

    expect(byScreen.find((item) => item.id === 'pRevSane')?.appliedBy).toBe('screen');
    expect(byEvaluation.find((item) => item.id === 'pRevSane')?.appliedBy).toBe('evaluation');
    // Порог капитализации screen не применял ни в одном профиле.
    expect(byScreen.find((item) => item.id === 'mcapAboveMin')?.appliedBy).toBe('evaluation');
    expect(DEEP_VALUE_PROFILE.thresholds.maxPRev).toBe(15);
    expect(DEFAULT_PROFILE.thresholds.maxPRev).toBe(60);
  });

  it('токен вне выборки получает 200 с причиной, а не 404', async () => {
    await universe.applyScreen({ enabled: true, profileId: 'default' });
    await service.run();

    const answer = await service.token('DX1');
    expect(answer.status).toBe('evaluated');

    const missing = await service.token('NOSUCH');
    expect(missing.status).toBe('not_in_selection');
    expect(missing.reason).toContain('нет в текущем снимке');
    expect(missing.nextAction).not.toBeNull();
  });
});
