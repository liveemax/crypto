import { validateEnv } from '../src/config/env.validation';

describe('validateEnv: ADMIN_API_KEY обязателен и не короче 32 символов', () => {
  it('пропускает валидный ключ без изменений остального конфига', () => {
    const key = 'a'.repeat(32);
    const result = validateEnv({ ADMIN_API_KEY: key, PORT: '3000' });
    expect(result.ADMIN_API_KEY).toBe(key);
    expect(result.PORT).toBe('3000');
  });

  it('НЕГАТИВНЫЙ: отсутствующий ADMIN_API_KEY — ошибка старта', () => {
    expect(() => validateEnv({})).toThrow(/ADMIN_API_KEY/);
  });

  it('НЕГАТИВНЫЙ: ADMIN_API_KEY короче 32 символов — ошибка старта', () => {
    expect(() => validateEnv({ ADMIN_API_KEY: 'a'.repeat(31) })).toThrow(/ADMIN_API_KEY/);
  });

  it('НЕГАТИВНЫЙ: пустая строка — та же ошибка, не тихий проход', () => {
    expect(() => validateEnv({ ADMIN_API_KEY: '' })).toThrow(/ADMIN_API_KEY/);
  });

  it('текст ошибки не содержит значение ключа', () => {
    const secret = 'short-secret-value';
    try {
      validateEnv({ ADMIN_API_KEY: secret });
      fail('ожидалась ошибка');
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
