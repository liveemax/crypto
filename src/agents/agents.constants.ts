/** Токен multi-provider: агенты подключаются через DI, а не через список имён. */
export const AGENT = Symbol('AGENT');

/**
 * Только для выпадающего списка Swagger. Поиск агента идёт по DI, поэтому имя
 * отсюда без зарегистрированного провайдера честно отвечает 404, а не заглушкой.
 */
export const AGENT_NAMES = [
  'screener',
  'unlocks',
  'sector-position',
  'mechanism',
  'critic',
] as const;