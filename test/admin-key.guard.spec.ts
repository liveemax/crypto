import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminKeyGuard } from '../src/api/http/admin-key.guard';

const ADMIN_KEY = 'unit-test-admin-key-0123456789abcdef';

function contextFor(method: string, headers: Record<string, string | string[]> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, headers }),
    }),
  } as unknown as ExecutionContext;
}

function guardWithKey(key: string): AdminKeyGuard {
  const config = { get: () => key } as unknown as ConfigService;
  return new AdminKeyGuard(config);
}

describe('AdminKeyGuard: единственная проверка X-Admin-Key', () => {
  const guard = guardWithKey(ADMIN_KEY);

  it.each(['GET', 'HEAD', 'OPTIONS', 'get', 'head', 'options'])(
    '%s проходит без заголовка',
    (method) => {
      expect(guard.canActivate(contextFor(method))).toBe(true);
    },
  );

  it('POST с точным ключом проходит', () => {
    expect(guard.canActivate(contextFor('POST', { 'x-admin-key': ADMIN_KEY }))).toBe(true);
  });

  it('НЕГАТИВНЫЙ: POST без заголовка — 401 admin_unauthorized', () => {
    expect(() => guard.canActivate(contextFor('POST'))).toThrow(UnauthorizedException);
    try {
      guard.canActivate(contextFor('POST'));
      fail('ожидалась ошибка');
    } catch (error) {
      const response = (error as UnauthorizedException).getResponse() as { code: string };
      expect(response.code).toBe('admin_unauthorized');
    }
  });

  it('НЕГАТИВНЫЙ: PUT с неверным ключом — 401, тот же code', () => {
    expect(() => guard.canActivate(contextFor('PUT', { 'x-admin-key': 'wrong' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('НЕГАТИВНЫЙ: DELETE с ключом другой длины — 401, а не падение сравнения', () => {
    expect(() =>
      guard.canActivate(contextFor('DELETE', { 'x-admin-key': ADMIN_KEY.slice(0, 5) })),
    ).toThrow(UnauthorizedException);
  });

  it('НЕГАТИВНЫЙ: пустой ADMIN_API_KEY в конфиге не даёт пройти пустым заголовком', () => {
    const emptyKeyGuard = guardWithKey('');
    expect(() =>
      emptyKeyGuard.canActivate(contextFor('POST', { 'x-admin-key': '' })),
    ).toThrow(UnauthorizedException);
  });

  it('повторный header (массив) берёт первое значение', () => {
    expect(
      guard.canActivate(contextFor('PATCH', { 'x-admin-key': [ADMIN_KEY, 'other'] })),
    ).toBe(true);
  });
});
