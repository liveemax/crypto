import { ConflictException } from '@nestjs/common';
import { EvaluationService } from '../src/core/evaluation/evaluation.service';
import type { EvaluationRun } from '../src/core/evaluation/evaluation.types';
import { JobService } from '../src/core/jobs/job.service';
import { ManualService } from '../src/core/manual/manual.service';
import type { ManualIncentiveOverrideRecord } from '../src/core/manual/manual.types';
import { RankingService } from '../src/core/ranking/ranking.service';
import type { RankingRun } from '../src/core/ranking/ranking.types';
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
    passed: true,
    rejectedAt: null,
    rejectReason: null,
    ...overrides,
  };
}

function named(
  coingeckoId: string,
  ticker: string,
  name: string,
  overrides: Partial<UniverseCandidate> = {},
): UniverseCandidate {
  return candidate({ coingeckoId, ticker, name, ...overrides });
}

function population(): UniverseCandidate[] {
  return [
    named('dx1', 'DX1', 'Dex One', {
      sector: 'dexs',
      comparisonGroup: 'dexs',
      tier: 'yield',
      pRev: 4,
      holderYieldPct: 9,
      revenue12mUsd: 60_000_000,
      overhangPct: 10,
    }),
    named('dx2', 'DX2', 'Dex Two', {
      sector: 'dexs',
      comparisonGroup: 'dexs',
      tier: 'yield',
      pRev: 6,
      holderYieldPct: 7,
      revenue12mUsd: 40_000_000,
      overhangPct: 20,
    }),
    named('lend1', 'LEND1', 'Aave Lending', {
      sector: 'lending',
      comparisonGroup: 'lending',
      tier: 'economics',
      holdersRevenue12mUsd: 0,
      holderYieldPct: 0,
      pRev: 12,
      overhangPct: 30,
    }),
    named('lend2', 'LEND2', 'Compound Lending', {
      sector: 'lending',
      comparisonGroup: 'lending',
      tier: 'pool',
      revenue12mUsd: null,
      holdersRevenue12mUsd: null,
      holderYieldPct: null,
      pRev: null,
      revenueState: 'source_missing',
      overhangPct: 40,
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

describe('ШАГ 1.3/1.4: RankingService.list() query и .options()', () => {
  let snapshot: UniverseSnapshot;
  let filterState: { value: unknown };
  let evaluationRuns: EvaluationRun[];
  let rankingRuns: RankingRun[];
  let store: StoreService;
  let universe: UniverseService;
  let evaluation: EvaluationService;
  let ranking: RankingService;

  beforeEach(() => {
    snapshot = snapshotOf(population());
    filterState = { value: null };
    evaluationRuns = [];
    rankingRuns = [];
    const incentiveOverrides = new Map<string, ManualIncentiveOverrideRecord>();
    const manual = {
      incentiveOverridesByCoingeckoId: jest.fn(async () => incentiveOverrides),
    } as unknown as ManualService;

    store = {
      loadSnapshot: jest.fn(async () => snapshot),
      saveSnapshot: jest.fn(async () => '/tmp/universe.json'),
      loadState: jest.fn(async () => filterState.value ?? null),
      saveState: jest.fn(async (_name: string, value: unknown) => {
        filterState.value = value;
        return '/tmp/active-filters.json';
      }),
      saveRun: jest.fn(async (kind: string, _runId: string, value: unknown) => {
        if (kind === 'evaluations') evaluationRuns.push(value as EvaluationRun);
        else if (kind === 'rankings') rankingRuns.push(value as RankingRun);
        return '/tmp/run.json';
      }),
      loadRun: jest.fn(async (kind: string) => {
        if (kind === 'evaluations') return evaluationRuns.at(-1) ?? null;
        if (kind === 'rankings') return rankingRuns.at(-1) ?? null;
        return null;
      }),
      saveReport: jest.fn(async () => '/tmp/report.md'),
      loadReport: jest.fn(async () => null),
      appendJournal: jest.fn(async () => true),
    } as unknown as StoreService;

    universe = new UniverseService(
      store,
      {} as unknown as UniverseBuilder,
      new UniverseFilter(),
      new JobService(),
      new FilterStateService(store),
    );
    evaluation = new EvaluationService(store, universe, manual);
    ranking = new RankingService(store, evaluation);
  });

  it('q ищет по evaluation.name/ticker/coingeckoId без учёта регистра, до пагинации', async () => {
    await ranking.run({ profileId: 'default' });
    const page = await ranking.list({ q: 'aave' });
    expect(page.pagination.total).toBe(1);
    expect((page.items[0] as { ticker: string }).ticker).toBe('LEND1');
  });

  it('dataTier фильтрует по evaluation.dataTier, а не по rankTier', async () => {
    await ranking.run({ profileId: 'default' });
    const page = await ranking.list({ dataTier: 'pool' });
    expect(page.pagination.total).toBe(1);
    expect((page.items[0] as { ticker: string }).ticker).toBe('LEND2');
  });

  it('comparisonGroup — точное совпадение без учёта регистра', async () => {
    await ranking.run({ profileId: 'default' });
    const page = await ranking.list({ comparisonGroup: 'LENDING' });
    expect(page.pagination.total).toBe(2);
    expect(page.items.map((item) => (item as { ticker: string }).ticker).sort()).toEqual([
      'LEND1',
      'LEND2',
    ]);
  });

  it('фильтры не меняют tiers верхнего уровня — это totals всего run', async () => {
    await ranking.run({ profileId: 'default' });
    const full = await ranking.list();
    const filtered = await ranking.list({ comparisonGroup: 'lending' });
    expect(filtered.tiers).toEqual(full.tiers);
    expect(filtered.pagination.total).toBeLessThan(full.pagination.total);
  });

  it('sort=name упорядочивает алфавитно; run.candidates не мутируется между вызовами', async () => {
    const run = await ranking.run({ profileId: 'default' });
    const before = JSON.stringify(run.candidates.map((c) => c.evaluation.coingeckoId));

    const asc = await ranking.list({ sort: 'name', order: 'asc' });
    expect(asc.items.map((item) => (item as { name: string }).name)).toEqual([
      'Aave Lending',
      'Compound Lending',
      'Dex One',
      'Dex Two',
    ]);

    await ranking.list({ dataTier: 'yield' });
    expect(JSON.stringify(run.candidates.map((c) => c.evaluation.coingeckoId))).toBe(before);
  });

  it('sort=tier default: A → B → C → watchlist, внутри тира — composite desc, затем coingeckoId asc', async () => {
    await ranking.run({ profileId: 'default' });
    const page = await ranking.list();
    const tiers = page.items.map((item) => (item as { rankTier: string }).rankTier);
    const order: Record<string, number> = { A: 0, B: 1, C: 2, watchlist: 3 };
    for (let i = 1; i < tiers.length; i += 1) {
      expect(order[tiers[i - 1]]).toBeLessThanOrEqual(order[tiers[i]]);
    }
  });

  it('options() без сохранённого run — тот же conflict ranking_missing, а не пустой список', async () => {
    expect.assertions(2);
    try {
      await ranking.options();
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      const response = (error as ConflictException).getResponse() as Record<string, unknown>;
      expect(response.code).toBe('ranking_missing');
    }
  });

  it('options() строит уникальный отсортированный comparisonGroups по кандидатам run', async () => {
    await ranking.run({ profileId: 'default' });
    const options = await ranking.options();
    expect(options.comparisonGroups).toEqual(['dexs', 'lending']);
    expect(options.runId).toEqual(expect.any(String));
  });
});
