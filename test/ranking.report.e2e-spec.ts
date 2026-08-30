import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request = require('supertest');
import { TEST_ADMIN_KEY } from './support/admin-key';
import { AppModule } from '../src/app.module';
import { RESEARCH_DISCLAIMER } from '../src/core/disclaimer';
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

function population(): UniverseCandidate[] {
  return [named('AAVE'), named('LEND2', { pRev: 24, holderYieldPct: 1.4, revenue12mUsd: 40_000_000, overhangPct: 25 })];
}

describe('GET /ranking/report/:runId и reports/journal.md (шаг 16.1, e2e)', () => {
  let app: INestApplication;
  let root: string;
  let reportsRoot: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'crypto-report-'));
    reportsRoot = join(root, 'reports');
    const store = new StoreService(root, reportsRoot);
    const snapshot: UniverseSnapshot = {
      version: '2026-08-29',
      builtAt: '2026-08-29T06:00:00.000Z',
      topN: 2,
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

  it('два прогона в один день сохраняют разные отчёты по runId, без перезаписи', async () => {
    const first = await request(app.getHttpServer())
      .post('/ranking/run').set('X-Admin-Key', TEST_ADMIN_KEY)
      .send({ profileId: 'deep-value' })
      .expect(200);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await request(app.getHttpServer())
      .post('/ranking/run').set('X-Admin-Key', TEST_ADMIN_KEY)
      .send({ profileId: 'deep-value' })
      .expect(200);

    const runId1 = first.body.runId as string;
    const runId2 = second.body.runId as string;
    expect(runId1).not.toBe(runId2);

    const report1 = await request(app.getHttpServer()).get(`/ranking/report/${runId1}`).expect(200);
    const report2 = await request(app.getHttpServer()).get(`/ranking/report/${runId2}`).expect(200);

    expect(report1.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(report2.headers['content-type']).toBe('text/markdown; charset=utf-8');
    // Markdown не завёрнут в JSON-строку: тело — сырой текст, не разобранный объект.
    expect(typeof report1.text).toBe('string');
    expect(report1.text).toContain(runId1);
    expect(report2.text).toContain(runId2);
    expect(report1.text).not.toContain(runId2);
    expect(report1.text).toContain(RESEARCH_DISCLAIMER);

    const journal = await readFile(join(reportsRoot, 'journal.md'), 'utf8');
    expect(journal.match(new RegExp(runId1, 'g'))).toHaveLength(1);
    expect(journal.match(new RegExp(runId2, 'g'))).toHaveLength(1);
  });

  it('неизвестный runId — нормализованная 404 с application/json, а не text/markdown', async () => {
    const response = await request(app.getHttpServer()).get('/ranking/report/not-existing-run');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(typeof response.body.code).toBe('string');
    expect('details' in response.body).toBe(true);
    expect('nextAction' in response.body).toBe(true);
  });

  it('дисклеймер дословно присутствует в evaluation и ranking JSON-ответах', async () => {
    await request(app.getHttpServer()).post('/ranking/run').set('X-Admin-Key', TEST_ADMIN_KEY).send({ profileId: 'deep-value' }).expect(200);

    const evaluationLatest = await request(app.getHttpServer())
      .get('/evaluation/latest?limit=1')
      .expect(200);
    const rankingLatest = await request(app.getHttpServer()).get('/ranking/latest?limit=1').expect(200);

    expect(evaluationLatest.body.disclaimer).toBe(RESEARCH_DISCLAIMER);
    expect(rankingLatest.body.disclaimer).toBe(RESEARCH_DISCLAIMER);
  });
});
