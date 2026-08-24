import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const config = new DocumentBuilder()
    .setTitle('Crypto Agents')
    .setDescription(
      'Исследовательский инструмент. Выдаёт проверяемые данные с источниками и ' +
        'уровнем уверенности, а не рекомендации покупать или продавать. ' +
        'Каждое число снабжено ссылкой на источник и датой актуальности.',
    )
    .setVersion('1.0')
    .addTag('system', 'Служебное')
    .addTag('config', 'Вселенная токенов и настройки')
    .addTag('snapshot', 'Слой данных')
    .addTag('agents', 'Агенты — по одному на токен')
    .addTag('manual', 'Ручные вводы: разлоки, документация, оверрайды')
    .addTag('ranking', 'Полный прогон и рейтинг')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: { tryItOutEnabled: true, persistAuthorization: true },
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Swagger: http://localhost:${port}/api`);
}

void bootstrap();
