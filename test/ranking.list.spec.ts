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

function population(): UniverseCandidate[] {
  return [
    named('DX1', { pRev: 4, holderYieldPct: 9, revenue12mUsd: 60_000_000, overhangPct: 10 }),
    named('DX2', { pRev: 6, holderYieldPct: 7, revenue12mUsd: 40_000_000, overhangPct: 20 }),
    named('DX3', { pRev: 8, holderYieldPct: 5, revenue12mUsd: 30_000_000, overhangPct: 30 }),
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

describe('ШАГ 15.2: конверт и страницы ranking', () => {
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

  it('list() без сохранённого run отвечает conflict с nextAction на POST /ranking/run', async () => {
    expect.assertions(3);
    try {
      await ranking.list();
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      const response = (error as ConflictException).getResponse() as Record<string, unknown>;
      expect(response.code).toBe('ranking_missing');
      expect(response.nextAction).toEqual({ method: 'POST', path: '/ranking/run', body: {} });
    }
  });

  it('runPaged() возвращает страницу summary по умолчанию, а run() — все карточки без пагинации', async () => {
    const full = await ranking.run({ profileId: 'default' });
    const paged = await ranking.runPaged({ profileId: 'default' });

    expect(full.candidates.length).toBe(3);
    expect(paged.pagination).toEqual({ offset: 0, limit: 50, total: 3, hasMore: false });
    expect(paged.items).toHaveLength(3);
    expect(paged.candidateCount).toBe(3);
    expect(paged.evaluationRunId).toBe(full.evaluationRunId);
    // Второй прогон переиспользует ту же совместимую evaluation первого.
    expect(paged.evaluationRecomputed).toBe(false);
    expect(paged.inputHashes).toEqual(full.inputHashes);
    // Summary по умолчанию: тяжёлой evaluation-карточки в строке нет, только баллы и тир.
    const row = paged.items[0] as { scores?: unknown; evaluation?: unknown };
    expect(row.scores).toBeDefined();
    expect(row.evaluation).toBeUndefined();
  });

  it('list(view=full) отдаёт полную RankedCandidate-карточку с evaluation внутри', async () => {
    await ranking.run({ profileId: 'default' });
    const page = await ranking.list({ view: 'full', limit: 1 });

    expect(page.pagination).toEqual({ offset: 0, limit: 1, total: 3, hasMore: true });
    const item = page.items[0] as { evaluation?: { coingeckoId?: string } };
    expect(item.evaluation?.coingeckoId).toBeDefined();
  });

  it('watchlist попадает в totals по tiers наравне с A/B/C', async () => {
    await ranking.run({ profileId: 'default' });
    const page = await ranking.list();
    const total = Object.values(page.tiers).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(3);
    expect(page.tiers).toHaveProperty('watchlist');
  });

  it('лимит выше страницы обрезается пагинацией, а не отдаёт всё разом', async () => {
    await ranking.run({ profileId: 'default' });
    const page = await ranking.list({ offset: 1, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.pagination).toEqual({ offset: 1, limit: 1, total: 3, hasMore: true });
  });
});
