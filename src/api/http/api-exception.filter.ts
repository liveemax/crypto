import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { errorBody, isApiErrorBody, NEXT, type ApiErrorBody } from '../../core/errors';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/** Коды по умолчанию для исключений, брошенных не через фабрики core/errors. */
const FALLBACK_CODE: Record<number, string> = {
  400: 'validation_failed',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  429: 'rate_limited',
};

/**
 * Единый формат ответа на ошибку. Нужен как раз для того, что бросили не мы:
 * ValidationPipe и роутер Nest отвечают своей формой, и клиент без кода ошибки
 * вынужден разбирать русский текст.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const body = this.bodyOf(exception, status);
    if (status >= 500) this.logger.error(`${body.code}: ${this.rawMessage(exception)}`);
    host.switchToHttp().getResponse<JsonResponse>().status(status).json(body);
  }

  private bodyOf(exception: unknown, status: number): ApiErrorBody {
    if (status >= 500) {
      return errorBody(
        'internal_error',
        'Внутренняя ошибка сервиса. Подробности — в логах процесса.',
        null,
        NEXT.status,
      );
    }

    const response = exception instanceof HttpException ? exception.getResponse() : null;
    if (isApiErrorBody(response)) {
      return errorBody(
        response.code,
        response.message,
        response.details ?? null,
        response.nextAction ?? null,
      );
    }

    const code = FALLBACK_CODE[status] ?? 'request_failed';
    const messages = this.messagesOf(response);
    return errorBody(
      code,
      status === 404
        ? 'Такого маршрута нет. Актуальный список — в Swagger на /api.'
        : (messages[0] ?? 'Запрос отклонён.'),
      messages.length > 0 ? { errors: messages } : null,
      status === 404 ? NEXT.swagger : null,
    );
  }

  private messagesOf(response: unknown): string[] {
    if (typeof response === 'string') return [response];
    if (typeof response !== 'object' || response === null) return [];
    const message = (response as { message?: unknown }).message;
    if (typeof message === 'string') return [message];
    if (Array.isArray(message)) {
      return message.filter((item): item is string => typeof item === 'string');
    }
    return [];
  }

  private rawMessage(exception: unknown): string {
    return exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
  }
}