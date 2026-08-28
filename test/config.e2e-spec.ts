import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { AppModule } from '../src/app.module';

describe('ConfigController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => app.close());

  it('GET /config/universe возвращает ровно заданные 13 активов', async () => {
    const response = await request(app.getHttpServer()).get('/config/universe').expect(200);
    expect(response.body).toHaveLength(13);
    expect(response.body[0]).toEqual({
      ticker: 'HYPE', name: 'Hyperliquid', sector: 'perps', defillama: 'hyperliquid', coingecko: 'hyperliquid',
    });
  });

  it('GET /config/sectors считает проекты и сортирует секторы', async () => {
    const response = await request(app.getHttpServer()).get('/config/sectors').expect(200);
    expect(response.body).toEqual(expect.arrayContaining([
      { sector: 'lending', projects: 2 },
      { sector: 'lst', projects: 2 },
      { sector: 'perps', projects: 3 },
    ]));
    expect(response.body.map((item: { sector: string }) => item.sector)).toEqual(
      [...response.body.map((item: { sector: string }) => item.sector)].sort(),
    );
  });

  it('GET /config/thresholds возвращает неизменяемые настройки', async () => {
    const response = await request(app.getHttpServer()).get('/config/thresholds').expect(200);
    expect(response.body).toEqual({
      thresholds: { minMcapUsd: 50_000_000, minAnnualRevenueUsd: 1_000_000, maxPRev: 60 },
      weights: { tokenomics: 0.35, mechanism: 0.25, valuation: 0.2, sectorPosition: 0.2 },
      maxStaleDays: 45,
    });
  });

  it('GET /config/profiles возвращает три воспроизводимых профиля с rationale', async () => {
    const response = await request(app.getHttpServer()).get('/config/profiles').expect(200);

    expect(response.body.map((profile: { id: string }) => profile.id)).toEqual([
      'default',
      'yield-hunter',
      'deep-value',
    ]);
    expect(
      response.body.every((profile: { rationale: string }) => profile.rationale.length > 0),
    ).toBe(true);
  });
});
