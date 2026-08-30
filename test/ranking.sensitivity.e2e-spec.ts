import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { StoreService } from '../src/core/store/store.service';
import { EMPTY_TOKENOMICS } from '../src/core/tokenomics/tokenomics.constants';
import type { UniverseCandidate, UniverseSnapshot } from '../src/core/universe/universe.types';

const SNAPSHOT_NAME = 'universe-source';
const NOW = new Date().toISOString();

function candidate(overrides: Partial<UniverseCandidate> = {}): UniverseCandidate {
  return {
    ...EMPTY_TOKENOMICS,
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
    marketAsOf: NOW,
    turnoverPct: 22.03,
    floatPct: 96.4,
    fdvToMcap: 1.04,
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
    tier: 'yield',
    passed: false,
    rejectedAt: null,
    rejectReason: null,
    overhangPct: 15,
    ...overrides,
  };
}

function named(ticker: string, overrides: Partial<UniverseCandidate> = {}): UniverseCandidate {
  return candidate({
    coingeckoId: ticker.toLowerCase(),
    ticker,
    name: `${ticker} Lending`,
    ...overrides,
  });
}

// Хард-фильтр tokenomics подтверждён у LEND3: разлоки известны, NHY отрицателен.
function population(): UniverseCandidate[] {
  return [
    named('AAVE'),
    named('LEND2', { pRev: 24, holderYieldPct: 1.4, revenue12mUsd: 40_000_000, overhangPct: 25 }),
    named('LEND3', {
      pRev: 30,
      holderYieldPct: 0.5,
      revenue12mUsd: 12_000_000,
      overhangPct: 60,
      unlock12mPct: 25,
      netHolderYieldPct: -12,
      tokenomicsState: 'available',
      tokenomicsSource: 'https://defillama.com/unlocks/lend3',
      asOfTokenomics: NOW,
    }),
  ];
}

describe('POST /ranking/sensitivity (шаг 16.2, e2e)', () => {
  let app: INestApplication;
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'crypto-sensitivity-'));
    const store = new StoreService(root, join(root, 'reports'));
    const snapshot: UniverseSnapshot = {
      version: '2026-08-29',
      builtAt: '2026-08-29T06:00:00.000Z',
      topN: 3,
      sources: {},
      candidates: population(),
      excludedIds: [],
      warnings: [],
    };
    await store.saveSnapshot(SNAPSHOT_NAME, snapshot);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StoreService)
      .useValue(store)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('25 сценариев поверх сохранённого run, без нового ranking run и без сети', async () => {
    const run = await request(app.getHttpServer())
      .post('/ranking/run')
      .send({ profileId: 'deep-value' })
      .expect(200);
    const runId = run.body.runId as string;

    const before = await request(app.getHttpServer()).get('/ranking/latest?limit=1').expect(200);

    const first = await request(app.getHttpServer())
      .post('/ranking/sensitivity')
      .send({ runId })
      .expect(200);

    expect(first.body.runId).toBe(runId);
    expect(first.body.scenarios).toHaveLength(25);
    // Все 25 наборов весов уникальны и суммируются в 1.
    const seen = new Set<string>();
    for (const scenario of first.body.scenarios as Array<{ weights: Record<string, number> }>) {
      const sum = scenario.weights.tokenomics + scenario.weights.valuation + scenario.weights.sectorPosition;
      expect(sum).toBeCloseTo(1, 6);
      seen.add(JSON.stringify(scenario.weights));
    }
    expect(seen.size).toBe(25);
    expect(first.body.summary.scenarioCount).toBe(25);
    expect(['stable', 'sensitive', 'insufficient_data']).toContain(first.body.summary.interpretation);
    expect(first.body.pagination).toBeDefined();
    expect(first.body.disclaimer).toBeDefined();

    // Повтор того же запроса детерминирован.
    const second = await request(app.getHttpServer())
      .post('/ranking/sensitivity')
      .send({ runId })
      .expect(200);
    expect(second.body.summary).toEqual(first.body.summary);
    expect(second.body.items).toEqual(first.body.items);

    // Sensitivity ничего не сохраняет: последний ranking run не изменился.
    const after = await request(app.getHttpServer()).get('/ranking/latest?limit=1').expect(200);
    expect(after.body.runId).toBe(before.body.runId);
    expect(after.body.runId).toBe(runId);
  });

  it('LEND3 с подтверждённым отрицательным NHY остаётся watchlist во всех 25 сценариях', async () => {
    const run = await request(app.getHttpServer())
      .post('/ranking/run')
      .send({ profileId: 'deep-value' })
      .expect(200);

    const response = await request(app.getHttpServer())
      .post('/ranking/sensitivity')
      .send({ runId: run.body.runId })
      .expect(200);

    const items = response.body.items as Array<{
      ticker: string;
      baselineTier: string;
      tierChanges: number;
      tiersReached: string[];
    }>;
    const lend3 = items.find((item) => item.ticker === 'LEND3');
    expect(lend3).toBeDefined();
    expect(lend3?.baselineTier).toBe('watchlist');
    expect(lend3?.tierChanges).toBe(0);
    expect(lend3?.tiersReached).toEqual(['watchlist']);
  });

  it('НЕГАТИВНЫЙ: несуществующий runId — 4xx с code, details, nextAction', async () => {
    const response = await request(app.getHttpServer())
      .post('/ranking/sensitivity')
      .send({ runId: 'not-existing-run' });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(typeof response.body.code).toBe('string');
    expect('details' in response.body).toBe(true);
    expect('nextAction' in response.body).toBe(true);
  });

  it('НЕГАТИВНЫЙ: тело без runId — 4xx нормализованной валидации', async () => {
    const response = await request(app.getHttpServer()).post('/ranking/sensitivity').send({});

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(typeof response.body.code).toBe('string');
  });
});
