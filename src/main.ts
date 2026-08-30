import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { createSwaggerConfig } from './swagger.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  // Список источников — через .env: правка кода ради адреса фронтенда это дефект.
  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (origins.length > 0) {
    app.enableCors({
      origin: origins,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Admin-Key'],
    });
  }

  const document = SwaggerModule.createDocument(app, createSwaggerConfig());
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: { tryItOutEnabled: true, persistAuthorization: true },
  });

  // Спецификация отдельным файлом: клиент сайта генерируется из неё, а не из догадок.
  app
    .getHttpAdapter()
    .get('/api/openapi.json', (_request: unknown, response: { json: (body: unknown) => void }) => {
      response.json(document);
    });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Swagger: http://localhost:${port}/api`);
}

// Ошибка старта (например, короткий ADMIN_API_KEY) — короткое сообщение без
// stack trace: секрет в нём не участвует, а полный stack не должен утекать в лог.
void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Не удалось запустить сервис: ${message}`);
  process.exit(1);
});