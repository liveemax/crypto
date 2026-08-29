import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  // Список источников — через .env: правка кода ради адреса фронтенда это дефект.
  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (origins.length > 0) app.enableCors({ origin: origins });

  const config = new DocumentBuilder()
    .setTitle('Crypto Agents')
    .setDescription(
      'Исследовательский инструмент. Выдаёт проверяемые данные с источниками и ' +
        'уровнем уверенности, а не рекомендации покупать или продавать. ' +
        'Каждое число снабжено ссылкой на источник и датой актуальности.',
    )
    .setVersion('1.0')
    .addTag('system', 'Состояние системы: что идёт и что делать дальше')
    .addTag('universe', 'Состав, числа, отбор и объяснение по одному токену')
    .addTag('evaluation', 'Кодовая оценка: valuation, tokenomics, sectorPosition')
    .addTag('manual', 'Ручные вводы: разлоки, документация, оверрайды')
    .addTag('config', 'Профили, пороги и веса')
    .build();

  const document = SwaggerModule.createDocument(app, config);
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

void bootstrap();