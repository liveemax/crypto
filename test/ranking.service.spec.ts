import { NotFoundException } from '@nestjs/common';
import { DEEP_VALUE_PROFILE, DEFAULT_PROFILE } from '../src/config/profiles';
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

/**
 * Шесть строк одной ниши: чистая тройка компонентов (DX1-DX3), подтверждённый
 * хард-фильтр tokenomics (NEG), полный пробел экономики (POOL, только ось
 * предложения) и провал абсолютных проверок valuation по выручке (LOWREV).
 */
function population(): UniverseCandidate[] {
  return [
    named('DX1', { pRev: 4, holderYieldPct: 9, revenue12mUsd: 60_000_000, overhangPct: 10 }),
    named('DX2', { pRev: 6, holderYieldPct: 7, revenue12mUsd: 40_000_000, overhangPct: 20 }),
    named('DX3', { pRev: 8, holderYieldPct: 5, revenue12mUsd: 30_000_000, overhangPct: 30 }),
    // Подтверждённый календарь и отрицательный NHY: хард-фильтр tokenomics обязан сработать.
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
    // Экономики нет вовсе: valuation не пройдёт абсолютные проверки (hasRevenue).
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

describe('ШАГ 15.1: ядро ranking, композит и сохранение run', () => {
  let snapshot: UniverseSnapshot;
  let filterState: { value: unknown };
  let evaluationRuns: EvaluationRun[];
  let rankingRuns: RankingRun[];
  let store: StoreService;
  let universe: UniverseService;
  let evaluation: EvaluationService;
  let ranking: RankingService;
  let manual: ManualService;
  let jobs: JobService;

  beforeEach(() => {
    snapshot = snapshotOf(population());
    filterState = { value: null };
    evaluationRuns = [];
    rankingRuns = [];
    const incentiveOverrides = new Map<string, ManualIncentiveOverrideRecord>();
    manual = {
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
      loadRunById: jest.fn(async (kind: string, runId: string) => {
        if (kind !== 'rankings') return null;
        return rankingRuns.find((run) => run.runId === runId) ?? null;
      }),
      saveReport: jest.fn(async () => '/tmp/report.md'),
      loadReport: jest.fn(async () => null),
      appendJournal: jest.fn(async () => true),
    } as unknown as StoreService;

    jobs = new JobService();
    universe = new UniverseService(
      store,
      {} as unknown as UniverseBuilder,
      new UniverseFilter(),
      jobs,
      new FilterStateService(store),
    );
    evaluation = new EvaluationService(store, universe, manual);
    ranking = new RankingService(store, evaluation);
  });

  it('первый прогон без сохранённой evaluation пересчитывает её и сохраняет ranking run', async () => {
    const acquireSpy = jest.spyOn(jobs, 'tryAcquire');
    const result = await ranking.run({ profileId: 'default' });

    expect(result.evaluationRecomputed).toBe(true);
    expect(result.candidateCount).toBe(result.candidates.length);
    expect(result.candidateCount).toBeGreaterThan(0);
    expect(Object.values(result.tiers).reduce((sum, count) => sum + count, 0)).toBe(result.candidateCount);
    expect(result.formulaVersions.ranking).toBe('ranking-composite-v1');
    expect(rankingRuns).toHaveLength(1);
    // Ranking считается локально: слот JobService не занимается ни разу.
    expect(acquireSpy).not.toHaveBeenCalled();
  });

  it('повтор на совместимом вводе не пересчитывает evaluation и детерминирован', async () => {
    const runSpy = jest.spyOn(evaluation, 'run');
    const first = await ranking.run({ profileId: 'default' });
    const second = await ranking.run({ profileId: 'default' });

    expect(first.evaluationRecomputed).toBe(true);
    expect(second.evaluationRecomputed).toBe(false);
    // evaluation.run() вызван ровно один раз: за первый прогон, второй переиспользовал сохранённый.
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(evaluationRuns).toHaveLength(1);

    const byTicker = (run: RankingRun) =>
      new Map(run.candidates.map((item) => [item.evaluation.ticker, item]));
    const firstByTicker = byTicker(first);
    const secondByTicker = byTicker(second);
    for (const [ticker, candidate] of firstByTicker) {
      const repeated = secondByTicker.get(ticker)!;
      expect(repeated.composite).toBe(candidate.composite);
      expect(repeated.rankTier).toBe(candidate.rankTier);
    }
  });

  it('смена профиля пересчитывает evaluation заново и совпадает с ranking профилем', async () => {
    await ranking.run({ profileId: 'default' });
    const second = await ranking.run({ profileId: DEEP_VALUE_PROFILE.id });

    expect(second.evaluationRecomputed).toBe(true);
    expect(second.rankingProfileId).toBe(DEEP_VALUE_PROFILE.id);
    expect(evaluationRuns.at(-1)?.evaluationProfileId).toBe(DEEP_VALUE_PROFILE.id);
  });

  it('хард-фильтр tokenomics оставляет кандидата в watchlist с причиной, а не убирает его', async () => {
    const result = await ranking.run({ profileId: 'default' });
    const neg = result.candidates.find((item) => item.evaluation.ticker === 'NEG');

    expect(neg).toBeDefined();
    expect(neg?.rankTier).toBe('watchlist');
    expect(neg?.hardFilters.some((flag) => flag.id === 'tokenomics_hard_filter')).toBe(true);
    expect(neg?.evaluation.tokenomics.verdict.hardFilterFail).toBe(true);
  });

  it('провал абсолютных проверок valuation тоже уводит в watchlist, но кандидат остаётся в run', async () => {
    const result = await ranking.run({ profileId: 'default' });
    const pool = result.candidates.find((item) => item.evaluation.ticker === 'POOL');

    expect(pool).toBeDefined();
    expect(pool?.rankTier).toBe('watchlist');
    expect(pool?.hardFilters.some((flag) => flag.id === 'valuation_failed')).toBe(true);
    expect(pool?.whatWouldChangeThis.length).toBeGreaterThan(0);
  });

  it('чистый кандидат с тремя компонентами получает composite и notEvaluated виден в карточке', async () => {
    const result = await ranking.run({ profileId: 'default' });
    const dx1 = result.candidates.find((item) => item.evaluation.ticker === 'DX1')!;

    expect(dx1.hardFilters).toEqual([]);
    expect(dx1.componentsUsed.length).toBeGreaterThanOrEqual(2);
    expect(dx1.composite).not.toBeNull();
    expect(['A', 'B', 'C']).toContain(dx1.rankTier);
    expect(dx1.evaluation.notEvaluated).toEqual([
      expect.objectContaining({ id: 'mechanism' }),
    ]);
  });

  it('сработавший риск-флаг снижает composite ровно на flagPenalty кандидата', async () => {
    // Экстремальный оборот включает high_turnover у DX1: penalty известен заранее.
    snapshot = snapshotOf(
      population().map((item) => (item.ticker === 'DX1' ? { ...item, turnoverPct: 90 } : item)),
    );
    const result = await ranking.run({ profileId: 'default' });
    const dx1 = result.candidates.find((item) => item.evaluation.ticker === 'DX1')!;

    expect(dx1.evaluation.flagPenalty).toBeGreaterThan(0);
    expect(dx1.compositeBase).not.toBeNull();
    expect(dx1.composite).toBe(
      Math.max(0, Math.round((dx1.compositeBase! - dx1.evaluation.flagPenalty) * 10) / 10),
    );
  });

  describe('sensitivity(): ШАГ 16.2, 25 весовых сценариев поверх сохранённого run', () => {
    it('ровно 25 сценариев, ни сети, ни нового ranking run', async () => {
      const run = await ranking.run({ profileId: 'default' });
      const before = rankingRuns.length;

      const result = await ranking.sensitivity({ runId: run.runId });

      expect(result.scenarios).toHaveLength(25);
      expect(result.runId).toBe(run.runId);
      expect(rankingRuns.length).toBe(before);
      expect(result.summary.scenarioCount).toBe(25);
    });

    it('повтор того же запроса детерминирован', async () => {
      const run = await ranking.run({ profileId: 'default' });

      const first = await ranking.sensitivity({ runId: run.runId });
      const second = await ranking.sensitivity({ runId: run.runId });

      expect(first.summary).toEqual(second.summary);
      expect(first.items).toEqual(second.items);
    });

    it('NEG с хард-фильтром tokenomics остаётся watchlist во всех 25 сценариях', async () => {
      const run = await ranking.run({ profileId: 'default' });
      const result = await ranking.sensitivity({ runId: run.runId });

      const neg = result.items.find((item) => item.ticker === 'NEG');
      expect(neg).toBeDefined();
      expect(neg?.baselineTier).toBe('watchlist');
      expect(neg?.tierChanges).toBe(0);
      expect(neg?.tiersReached).toEqual(['watchlist']);
    });

    it('НЕГАТИВНЫЙ: неизвестный runId — нормализованная 4xx с nextAction на GET /ranking/latest', async () => {
      expect.assertions(3);
      try {
        await ranking.sensitivity({ runId: 'not-existing-run' });
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        const response = (error as NotFoundException).getResponse() as Record<string, unknown>;
        expect(response.code).toBe('ranking_run_missing');
        expect(response.nextAction).toEqual({ method: 'GET', path: '/ranking/latest', body: {} });
      }
    });
  });
});
