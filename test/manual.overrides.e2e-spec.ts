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
    marketAsOf: '2026-08-25T10:00:00.000Z',
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
    ...overrides,
  };
}

function population(): UniverseCandidate[] {
  return [
    candidate(),
    candidate({ rank: 2, coingeckoId: 'wrapped-x', ticker: 'DUP', name: 'Wrapped X' }),
    candidate({ rank: 3, coingeckoId: 'wrapped-y', ticker: 'DUP', name: 'Wrapped Y' }),
  ];
}

describe('ManualController: POST/GET /manual/overrides/{token} (шаг 14.1, e2e)', () => {
  let app: INestApplication;
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'crypto-overrides-'));
    const store = new StoreService(root);
    const snapshot: UniverseSnapshot = {
      version: '2026-08-25',
      builtAt: '2026-08-25T06:00:00.000Z',
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

  const validBody = {
    incentives12mUsd: 1_200_000,
    sourceUrl: 'https://official.example/report',
    asOf: '2026-08-01T00:00:00.000Z',
  };

  it('POST сохраняет override, GET читает его по ticker и по coingeckoId как один объект', async () => {
    const posted = await request(app.getHttpServer())
      .post('/manual/overrides/AAVE').set('X-Admin-Key', TEST_ADMIN_KEY)
      .send(validBody)
      .expect(201);

    expect(posted.body).toMatchObject({
      ...validBody,
      coingeckoId: 'aave',
      ticker: 'AAVE',
      origin: 'manual',
    });
    expect(typeof posted.body.createdAt).toBe('string');

    const byTicker = await request(app.getHttpServer()).get('/manual/overrides/AAVE').expect(200);
    const byId = await request(app.getHttpServer()).get('/manual/overrides/aave').expect(200);
    expect(byTicker.body).toEqual({ coingeckoId: 'aave', ticker: 'AAVE', override: posted.body });
    expect(byId.body).toEqual({ coingeckoId: 'aave', ticker: 'AAVE', override: posted.body });
  });

  it('повторный POST заменяет запись: GET видит одну актуальную версию', async () => {
    await request(app.getHttpServer()).post('/manual/overrides/AAVE').set('X-Admin-Key', TEST_ADMIN_KEY).send(validBody).expect(201);
    await request(app.getHttpServer())
      .post('/manual/overrides/AAVE').set('X-Admin-Key', TEST_ADMIN_KEY)
      .send({ ...validBody, incentives12mUsd: 3_000_000 })
      .expect(201);

    const response = await request(app.getHttpServer()).get('/manual/overrides/AAVE').expect(200);
    expect(response.body.override.incentives12mUsd).toBe(3_000_000);
  });

  it('GET токена без записи отвечает 200 и override: null — законное состояние, не ошибка', async () => {
    const response = await request(app.getHttpServer()).get('/manual/overrides/wrapped-x').expect(200);
    expect(response.body).toEqual({ coingeckoId: 'wrapped-x', ticker: 'DUP', override: null });
  });

  it('НЕГАТИВНЫЙ: без sourceUrl — 400 с code и nextAction в теле', async () => {
    const response = await request(app.getHttpServer())
      .post('/manual/overrides/AAVE').set('X-Admin-Key', TEST_ADMIN_KEY)
      .send({ incentives12mUsd: 1_200_000, asOf: validBody.asOf })
      .expect(400);

    expect(typeof response.body.code).toBe('string');
    expect('nextAction' in response.body).toBe(true);
  });

  it('НЕГАТИВНЫЙ: без asOf — 400', async () => {
    await request(app.getHttpServer())
      .post('/manual/overrides/AAVE').set('X-Admin-Key', TEST_ADMIN_KEY)
      .send({ incentives12mUsd: 1_200_000, sourceUrl: validBody.sourceUrl })
      .expect(400);
  });

  it('НЕГАТИВНЫЙ: неверный sourceUrl — 400', async () => {
    await request(app.getHttpServer())
      .post('/manual/overrides/AAVE').set('X-Admin-Key', TEST_ADMIN_KEY)
      .send({ ...validBody, sourceUrl: 'not-a-url' })
      .expect(400);
  });

  it('НЕГАТИВНЫЙ: неверный asOf — 400', async () => {
    await request(app.getHttpServer())
      .post('/manual/overrides/AAVE').set('X-Admin-Key', TEST_ADMIN_KEY)
      .send({ ...validBody, asOf: 'не-дата' })
      .expect(400);
  });

  it('НЕГАТИВНЫЙ: отрицательный incentives12mUsd — 400', async () => {
    await request(app.getHttpServer())
      .post('/manual/overrides/AAVE').set('X-Admin-Key', TEST_ADMIN_KEY)
      .send({ ...validBody, incentives12mUsd: -1 })
      .expect(400);
  });

  it('НЕГАТИВНЫЙ: неоднозначный тикер — 409 со списком coingeckoId', async () => {
    const response = await request(app.getHttpServer())
      .post('/manual/overrides/DUP').set('X-Admin-Key', TEST_ADMIN_KEY)
      .send(validBody)
      .expect(409);

    expect(response.body.code).toBe('ambiguous_ticker');
    expect(response.body.details.candidates.map((item: { coingeckoId: string }) => item.coingeckoId).sort()).toEqual([
      'wrapped-x',
      'wrapped-y',
    ]);
  });

  it('НЕГАТИВНЫЙ: неизвестный токен — нормализованная 4xx', async () => {
    const response = await request(app.getHttpServer()).post('/manual/overrides/NOPE').set('X-Admin-Key', TEST_ADMIN_KEY).send(validBody);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(typeof response.body.code).toBe('string');
  });

  it('подтверждённый ноль сохраняется как ноль, а не как отсутствие', async () => {
    const response = await request(app.getHttpServer())
      .post('/manual/overrides/wrapped-x').set('X-Admin-Key', TEST_ADMIN_KEY)
      .send({ ...validBody, incentives12mUsd: 0 })
      .expect(201);

    expect(response.body.incentives12mUsd).toBe(0);
    const read = await request(app.getHttpServer()).get('/manual/overrides/wrapped-x').expect(200);
    expect(read.body.override.incentives12mUsd).toBe(0);
  });
});
