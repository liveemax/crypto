import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request = require('supertest');
import { TEST_ADMIN_KEY } from './support/admin-key';
import { AppModule } from '../src/app.module';
import { StoreService } from '../src/core/store/store.service';
import { EMPTY_TOKENOMICS } from '../src/core/tokenomics/tokenomics.constants';
import type { UniverseCandidate, UniverseSnapshot } from '../src/core/universe/universe.types';

// Имя снапшота внутри UniverseService: см. private SNAPSHOT_NAME = 'universe-source'.
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

// Хард-фильтр tokenomics подтверждён: разлоки известны, NHY отрицателен.
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

describe('RankingController: POST /ranking/run, GET /ranking/latest (шаг 15.2, e2e)', () => {
  let app: INestApplication;
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'crypto-ranking-'));
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

  it('GET /ranking/latest без сохранённого run — нормализованная 4xx с nextAction на POST /ranking/run', async () => {
    const response = await request(app.getHttpServer()).get('/ranking/latest');
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.body.code).toBe('ranking_missing');
    expect(response.body.nextAction).toEqual({ method: 'POST', path: '/ranking/run', body: {} });
  });

  it('POST /ranking/run отвечает 200 синхронно, без jobId, и сам пересчитывает evaluation', async () => {
    const response = await request(app.getHttpServer())
      .post('/ranking/run').set('X-Admin-Key', TEST_ADMIN_KEY)
      .send({ profileId: 'deep-value' })
      .expect(200);

    expect(response.body.jobId).toBeUndefined();
    expect(response.body.evaluationRecomputed).toBe(true);
    expect(response.body.candidateCount).toBe(3);
    expect(response.body.rankingProfileId).toBe('deep-value');
    expect(response.body.context.universeVersion).toBe('2026-08-29');
    expect(response.body.pagination).toEqual({ offset: 0, limit: 50, total: 3, hasMore: false });
    // Watchlist не прячется: totals по тирам считают его отдельным ключом.
    const tierTotal = Object.values(response.body.tiers as Record<string, number>).reduce(
      (sum: number, count: number) => sum + count,
      0,
    );
    expect(tierTotal).toBe(3);
    expect(response.body.tiers).toHaveProperty('watchlist');

    const status = await request(app.getHttpServer()).get('/status').expect(200);
    expect(status.body.job?.state).not.toBe('running');
  });

  it('LEND3 с подтверждённым отрицательным NHY остаётся в ответе как watchlist, а не исчезает', async () => {
    await request(app.getHttpServer()).post('/ranking/run').set('X-Admin-Key', TEST_ADMIN_KEY).send({ profileId: 'deep-value' }).expect(200);
    const page = await request(app.getHttpServer())
      .get('/ranking/latest?offset=0&limit=50&view=summary')
      .expect(200);

    const items = page.body.items as Array<{ ticker: string; rankTier: string; hardFilters: unknown[] }>;
    const lend3 = items.find((item) => item.ticker === 'LEND3');
    expect(lend3).toBeDefined();
    expect(lend3?.rankTier).toBe('watchlist');
    expect(lend3?.hardFilters.length).toBeGreaterThan(0);
    // Summary не тащит тяжёлую evaluation-карточку.
    expect((lend3 as unknown as { evaluation?: unknown }).evaluation).toBeUndefined();
  });

  it('view=full отдаёт полную evaluation-карточку одного кандидата', async () => {
    await request(app.getHttpServer()).post('/ranking/run').set('X-Admin-Key', TEST_ADMIN_KEY).send({ profileId: 'deep-value' }).expect(200);
    const page = await request(app.getHttpServer())
      .get('/ranking/latest?offset=0&limit=1&view=full')
      .expect(200);

    expect(page.body.items).toHaveLength(1);
    const item = page.body.items[0];
    expect(item.evaluation).toBeDefined();
    expect(item.evaluation.coingeckoId).toBeDefined();
    expect(item.rankTier).toBeDefined();
  });

  it('НЕГАТИВНЫЙ: limit=201 — 4xx с code, details, nextAction', async () => {
    const response = await request(app.getHttpServer()).get('/ranking/latest?offset=0&limit=201');
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(typeof response.body.code).toBe('string');
    expect('details' in response.body).toBe(true);
    expect('nextAction' in response.body).toBe(true);
  });

  it('НЕГАТИВНЫЙ: несуществующий profileId — 4xx с code, details, nextAction', async () => {
    const response = await request(app.getHttpServer())
      .post('/ranking/run').set('X-Admin-Key', TEST_ADMIN_KEY)
      .send({ profileId: 'not-a-real-profile' });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(typeof response.body.code).toBe('string');
    expect('details' in response.body).toBe(true);
    expect('nextAction' in response.body).toBe(true);
  });

  it('default-ответ GET /ranking/latest меньше 300 КБ на e2e fixture', async () => {
    await request(app.getHttpServer()).post('/ranking/run').set('X-Admin-Key', TEST_ADMIN_KEY).send({ profileId: 'deep-value' }).expect(200);
    const response = await request(app.getHttpServer()).get('/ranking/latest').expect(200);
    const size = Buffer.byteLength(JSON.stringify(response.body), 'utf8');
    expect(size).toBeLessThan(300 * 1024);
  });
});
