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

const SNAPSHOT_NAME = 'universe-source';
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
    marketSource: 'https://api.coingecko.com/api/v3/coins/markets',
    marketAsOf: NOW,
    turnoverPct: 10,
    floatPct: 80,
    fdvToMcap: 1.25,
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

function population(): UniverseCandidate[] {
  return [
    candidate({
      rank: 1,
      coingeckoId: 'aave',
      ticker: 'AAVE',
      name: 'Aave',
      sector: 'lending',
      comparisonGroup: 'lending',
      tier: 'yield',
    }),
    candidate({
      rank: 2,
      coingeckoId: 'compound',
      ticker: 'COMP',
      name: 'Compound',
      sector: 'lending',
      comparisonGroup: 'lending',
      tier: 'pool',
      revenue12mUsd: null,
      holdersRevenue12mUsd: null,
      holderYieldPct: null,
      pRev: null,
      revenueState: 'source_missing',
    }),
    candidate({
      rank: 3,
      coingeckoId: 'uniswap',
      ticker: 'UNI',
      name: 'Uniswap',
      sector: 'dexs',
      comparisonGroup: 'dexs',
      tier: 'yield',
    }),
  ];
}

describe('ШАГ 1.3/1.4: GET /ranking/latest q/rankTier/dataTier/comparisonGroup и GET /ranking/options (e2e)', () => {
  let app: INestApplication;
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'crypto-ranking-list-'));
    const store = new StoreService(root, join(root, 'reports'));
    const snapshot: UniverseSnapshot = {
      version: '2026-08-30',
      builtAt: '2026-08-30T06:00:00.000Z',
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

  it('GET /ranking/options без сохранённого run — тот же ranking_missing, не пустой список', async () => {
    const response = await request(app.getHttpServer()).get('/ranking/options');
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.body.code).toBe('ranking_missing');
    expect(response.body.nextAction).toEqual({ method: 'POST', path: '/ranking/run', body: {} });
  });

  it('q ищет по evaluation.name/ticker/coingeckoId без учёта регистра', async () => {
    await request(app.getHttpServer()).post('/ranking/run').set('X-Admin-Key', TEST_ADMIN_KEY).send({ profileId: 'default' }).expect(200);
    const response = await request(app.getHttpServer()).get('/ranking/latest?q=uni').expect(200);
    expect(response.body.pagination.total).toBe(1);
    expect(response.body.items[0].ticker).toBe('UNI');
  });

  it('dataTier фильтрует до пагинации, tiers верхнего уровня остаётся totals run', async () => {
    const full = await request(app.getHttpServer()).get('/ranking/latest').expect(200);
    const filtered = await request(app.getHttpServer())
      .get('/ranking/latest?dataTier=pool')
      .expect(200);
    expect(filtered.body.pagination.total).toBe(1);
    expect(filtered.body.items[0].ticker).toBe('COMP');
    expect(filtered.body.tiers).toEqual(full.body.tiers);
  });

  it('comparisonGroup=lending возвращает только группу lending', async () => {
    const response = await request(app.getHttpServer())
      .get('/ranking/latest?comparisonGroup=lending')
      .expect(200);
    expect(response.body.pagination.total).toBe(2);
    expect(
      (response.body.items as Array<{ ticker: string }>).map((item) => item.ticker).sort(),
    ).toEqual(['AAVE', 'COMP']);
  });

  it('GET /ranking/options строит уникальный отсортированный comparisonGroups', async () => {
    const response = await request(app.getHttpServer()).get('/ranking/options').expect(200);
    expect(response.body.comparisonGroups).toEqual(['dexs', 'lending']);
    expect(response.body.runId).toEqual(expect.any(String));
  });

  it('sort=name&order=desc — алфавитный порядок по убыванию', async () => {
    const response = await request(app.getHttpServer())
      .get('/ranking/latest?sort=name&order=desc')
      .expect(200);
    expect((response.body.items as Array<{ name: string }>).map((item) => item.name)).toEqual([
      'Uniswap',
      'Compound',
      'Aave',
    ]);
  });

  it('НЕГАТИВНЫЙ: order=sideways — нормализованная 4xx', async () => {
    const response = await request(app.getHttpServer()).get('/ranking/latest?order=sideways');
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(typeof response.body.code).toBe('string');
    expect('details' in response.body).toBe(true);
    expect('nextAction' in response.body).toBe(true);
  });

  it('НЕГАТИВНЫЙ: rankTier=Z — нормализованная 4xx', async () => {
    const response = await request(app.getHttpServer()).get('/ranking/latest?rankTier=Z');
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it('НЕГАТИВНЫЙ: limit=201 — нормализованная 4xx', async () => {
    const response = await request(app.getHttpServer()).get('/ranking/latest?limit=201');
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});
