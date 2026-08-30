import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { StoreService } from '../src/core/store/store.service';
import { validateEnv } from '../src/config/env.validation';
import { createSwaggerConfig } from '../src/swagger.config';
import { TEST_ADMIN_KEY } from './support/admin-key';

describe('ШАГ 2: защита всех мутаций X-Admin-Key (e2e)', () => {
  let app: INestApplication;
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'crypto-admin-key-'));
    const store = new StoreService(root, join(root, 'reports'));

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

  it('GET /status публичен без ключа', async () => {
    await request(app.getHttpServer()).get('/status').expect(200);
  });

  it('GET /config/profiles публичен без ключа', async () => {
    await request(app.getHttpServer()).get('/config/profiles').expect(200);
  });

  it('НЕГАТИВНЫЙ: POST без X-Admin-Key — 401 admin_unauthorized до бизнес-валидации', async () => {
    const response = await request(app.getHttpServer()).post('/universe/screen').send({});
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      code: 'admin_unauthorized',
      message: 'Для изменяющего запроса требуется доступ администратора.',
      details: null,
      nextAction: null,
    });
  });

  it('НЕГАТИВНЫЙ: POST с неверным X-Admin-Key — тот же безопасный 401', async () => {
    const response = await request(app.getHttpServer())
      .post('/universe/screen')
      .set('X-Admin-Key', 'definitely-not-the-real-admin-key-value')
      .send({});
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('admin_unauthorized');
  });

  it('валидный ключ допускает запрос к контроллеру: 400 валидации, а не 401', async () => {
    const response = await request(app.getHttpServer())
      .post('/universe/screen')
      .set('X-Admin-Key', TEST_ADMIN_KEY)
      .send({});
    expect(response.status).toBe(400);
    expect(response.body.code).not.toBe('admin_unauthorized');
  });

  it('НЕГАТИВНЫЙ: DELETE без ключа тоже требует admin — 401', async () => {
    const response = await request(app.getHttpServer()).delete('/manual/unlocks/anything');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('admin_unauthorized');
  });

  it('DELETE с валидным ключом проходит guard: ответ уже не 401', async () => {
    const response = await request(app.getHttpServer())
      .delete('/manual/unlocks/anything')
      .set('X-Admin-Key', TEST_ADMIN_KEY);
    expect(response.status).not.toBe(401);
  });

  it('OpenAPI содержит security scheme admin-key с заголовком X-Admin-Key', () => {
    const document = SwaggerModule.createDocument(app, createSwaggerConfig());
    expect(document.components?.securitySchemes?.['admin-key']).toEqual({
      type: 'apiKey',
      name: 'X-Admin-Key',
      in: 'header',
    });
  });
});

describe('ConfigModule.forRoot(validateEnv): без ADMIN_API_KEY приложение не стартует (e2e)', () => {
  it('НЕГАТИВНЫЙ: отсутствующий секрет останавливает компиляцию модуля', async () => {
    const previous = process.env.ADMIN_API_KEY;
    delete process.env.ADMIN_API_KEY;
    try {
      await expect(
        Test.createTestingModule({
          imports: [ConfigModule.forRoot({ validate: validateEnv, ignoreEnvFile: true })],
        }).compile(),
      ).rejects.toThrow(/ADMIN_API_KEY/);
    } finally {
      if (previous === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = previous;
    }
  });
});
