import { DocumentBuilder } from '@nestjs/swagger';

/**
 * Общий конфиг спецификации: main.ts использует его для реального сервера,
 * тесты — для проверки схемы без полного bootstrap с CORS и портом.
 */
export function createSwaggerConfig() {
  return new DocumentBuilder()
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
    .addTag('ranking', 'Композит трёх компонентов и тиры A/B/C/watchlist')
    .addTag('manual', 'Ручные вводы: разлоки, документация, оверрайды')
    .addTag('config', 'Профили, пороги и веса')
    .addApiKey({ type: 'apiKey', name: 'X-Admin-Key', in: 'header' }, 'admin-key')
    .build();
}
