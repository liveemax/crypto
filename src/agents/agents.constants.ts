/** Токен multi-provider: агенты подключаются через DI, а не через список имён. */
export const AGENT = Symbol('AGENT');

/**
 * Только для выпадающего списка Swagger. Кодовые оценки сюда не входят: они не
 * агенты и живут в core/evaluation. Имя отсюда без зарегистрированного
 * провайдера честно отвечает 404, а не заглушкой.
 */
export const AGENT_NAMES = ['mechanism', 'critic'] as const;