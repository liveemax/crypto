const MIN_ADMIN_KEY_LENGTH = 32;

/** Валидированный env: ADMIN_API_KEY гарантированно строка нужной длины. */
export interface ValidatedEnv {
  ADMIN_API_KEY: string;
  [key: string]: unknown;
}

/**
 * Останавливает запуск при пустом или коротком ADMIN_API_KEY: тихое отключение
 * защиты мутаций — не приемлемый режим работы, только явный отказ старта.
 */
export function validateEnv(config: Record<string, unknown>): ValidatedEnv {
  const adminApiKey = typeof config.ADMIN_API_KEY === 'string' ? config.ADMIN_API_KEY : '';
  if (adminApiKey.length < MIN_ADMIN_KEY_LENGTH) {
    throw new Error(
      `ADMIN_API_KEY обязателен и должен быть не короче ${MIN_ADMIN_KEY_LENGTH} символов ` +
        '(см. .env.example). Сервис не запускается, если мутации нечем защитить.',
    );
  }
  return { ...config, ADMIN_API_KEY: adminApiKey };
}
