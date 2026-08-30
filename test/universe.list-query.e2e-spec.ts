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
      mcapCalcUsd: 3_000_000_000,
    }),
    candidate({
      rank: 2,
      coingeckoId: 'uniswap',
      ticker: 'UNI',
      name: 'Uniswap',
      sector: 'dexs',
      comparisonGroup: 'dexs',
      mcapCalcUsd: 5_000_000_000,
    }),
    candidate({
      rank: 3,
      coingeckoId: 'no-cap',
      ticker: 'NOCAP',
      name: 'No Market Cap Coin',
      sector: null,
      comparisonGroup: null,
      mcapCalcUsd: null,
      passed: false,
      tier: 'rejected',
      rejectedAt: 'market_known',
      rejectReason: 'Неизвестны цена и circulating supply',
    }),
  ];
}

describe('ШАГ 1.1/1.2: GET /universe q/sort/order и GET /universe/options (e2e)', () => {
  let app: INestApplication;
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'crypto-universe-list-'));
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

  it('q ищет по name/ticker/coingeckoId без учёта регистра', async () => {
    const response = await request(app.getHttpServer())
      .get('/universe?passedOnly=false&q=uni')
      .expect(200);
    expect(response.body.pagination.total).toBe(1);
    expect(response.body.items[0].ticker).toBe('UNI');
  });

  it('passedOnly=false возвращает прошедшие и отсеянные с rejectReason', async () => {
    // Без включённого screen «отсев» — свойство композиции фильтров, а не снимка:
    // enabled:false в activeFilters возвращает весь снимок как прошедший.
    await request(app.getHttpServer())
      .post('/universe/screen')
      .send({ enabled: true, profileId: 'default' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get('/universe?passedOnly=false&sort=rank&order=asc')
      .expect(200);
    expect(response.body.pagination.total).toBe(3);
    const rejected = response.body.items.find((item: { ticker: string }) => item.ticker === 'NOCAP');
    expect(rejected.passed).toBe(false);
    expect(rejected.rejectReason).toBeTruthy();

    await request(app.getHttpServer()).post('/universe/screen').send({ enabled: false }).expect(201);
  });

  it('sort=mcapCalcUsd&order=desc — null всегда в конце', async () => {
    const response = await request(app.getHttpServer())
      .get('/universe?passedOnly=false&sort=mcapCalcUsd&order=desc')
      .expect(200);
    expect(response.body.items.map((item: { ticker: string }) => item.ticker)).toEqual([
      'UNI',
      'AAVE',
      'NOCAP',
    ]);
  });

  it('GET /universe/options строится по всей вселенной, не только по passed', async () => {
    const response = await request(app.getHttpServer()).get('/universe/options').expect(200);
    expect(response.body.sectors).toEqual(['dexs', 'lending']);
    expect(response.body.context.universeVersion).toBe('2026-08-30');
  });

  it('GET /universe/options не перехватывается роутом /universe/:token', async () => {
    const response = await request(app.getHttpServer()).get('/universe/options').expect(200);
    expect(response.body.sectors).toBeDefined();
    expect(response.body.inSnapshot).toBeUndefined();
  });

  it('НЕГАТИВНЫЙ: sort=not-a-field — нормализованная 4xx', async () => {
    const response = await request(app.getHttpServer()).get('/universe?sort=not-a-field');
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(typeof response.body.code).toBe('string');
    expect('details' in response.body).toBe(true);
    expect('nextAction' in response.body).toBe(true);
  });

  it('НЕГАТИВНЫЙ: order=sideways — нормализованная 4xx', async () => {
    const response = await request(app.getHttpServer()).get('/universe?order=sideways');
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(typeof response.body.code).toBe('string');
  });

  it('НЕГАТИВНЫЙ: limit=201 — нормализованная 4xx', async () => {
    const response = await request(app.getHttpServer()).get('/universe?limit=201');
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(typeof response.body.code).toBe('string');
  });

  it('НЕГАТИВНЫЙ: q длиннее 100 символов — нормализованная 4xx', async () => {
    const response = await request(app.getHttpServer()).get(`/universe?q=${'a'.repeat(101)}`);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(typeof response.body.code).toBe('string');
  });
});
