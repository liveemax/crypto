import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { unauthorized } from '../../core/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ADMIN_KEY_HEADER = 'x-admin-key';

interface AdminKeyRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
}

/** Сравнение постоянного времени: хеш нормирует длину, разные строки не текут через тайминг. */
function safeEqual(a: string, b: string): boolean {
  const bufferA = createHash('sha256').update(a).digest();
  const bufferB = createHash('sha256').update(b).digest();
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Единственная проверка X-Admin-Key на весь процесс: GET/HEAD/OPTIONS проходят
 * без ключа, любой другой метод — только с точным совпадением ADMIN_API_KEY.
 */
@Injectable()
export class AdminKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AdminKeyRequest>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

    const header = request.headers[ADMIN_KEY_HEADER];
    const provided = Array.isArray(header) ? header[0] : header;
    const expected = this.config.get<string>('ADMIN_API_KEY') ?? '';

    if (!provided || !safeEqual(provided, expected)) {
      throw unauthorized(
        'admin_unauthorized',
        'Для изменяющего запроса требуется доступ администратора.',
      );
    }
    return true;
  }
}
