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

  it('GET /config/thresholds возвращает неизменяемые настройки', async () => {
    const response = await request(app.getHttpServer()).get('/config/thresholds').expect(200);
    expect(response.body).toEqual({
      thresholds: { minMcapUsd: 50_000_000, minAnnualRevenueUsd: 1_000_000, maxPRev: 60 },
      weights: { tokenomics: 0.35, valuation: 0.2, sectorPosition: 0.2 },
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

  it('НЕГАТИВНЫЙ: удалённые эндпоинты отвечают 404 в едином формате', async () => {
    for (const path of [
      '/config/universe',
      '/config/sectors',
      '/snapshot',
      '/agents',
      '/analysis/mechanism/test',
      '/analysis/critic/test',
    ]) {
      const response = await request(app.getHttpServer()).get(path).expect(404);
      // Второй ответ на тот же вопрос всегда неверный, поэтому их нет; но тупика быть не должно.
      expect(response.body.code).toBe('not_found');
      expect(response.body.nextAction).toEqual({ method: 'GET', path: '/api', body: {} });
    }
  });
});
