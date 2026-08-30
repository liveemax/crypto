import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/** Что нажать дальше. Ошибка без перехода — тупик, а тупик это дефект интерфейса. */
export interface NextAction {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

/** Единое тело любого 4xx и 5xx: code машиночитаем, message для человека. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details: Record<string, unknown> | null;
  nextAction: NextAction | null;
}

/** Готовые переходы: путь выхода не должен придумываться в каждом месте заново. */
export const NEXT: Record<string, NextAction> = {
  buildUniverse: { method: 'POST', path: '/universe/refresh', body: {} },
  refreshPrices: { method: 'POST', path: '/universe/prices', body: {} },
  collectTokenomics: { method: 'POST', path: '/universe/tokenomics', body: {} },
  runEvaluation: { method: 'POST', path: '/evaluation/run', body: {} },
  latestEvaluation: { method: 'GET', path: '/evaluation/latest', body: {} },
  runRanking: { method: 'POST', path: '/ranking/run', body: {} },
  latestRanking: { method: 'GET', path: '/ranking/latest', body: {} },
  status: { method: 'GET', path: '/status', body: {} },
  profiles: { method: 'GET', path: '/config/profiles', body: {} },
  swagger: { method: 'GET', path: '/api', body: {} },
};

/** Собирает тело ошибки; все четыре ключа присутствуют всегда. */
export function errorBody(
  code: string,
  message: string,
  details: Record<string, unknown> | null = null,
  nextAction: NextAction | null = null,
): ApiErrorBody {
  return { code, message, details, nextAction };
}

/** true — объект уже в едином формате и переписывать его нельзя. */
export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === 'string' && typeof candidate.message === 'string';
}

/**
 * Классы Nest сохранены намеренно: instanceof BadRequestException проверяется
 * тестами и сужает тип в вызывающем коде, а структурное тело едет ответом.
 */
export function badRequest(
  code: string,
  message: string,
  details: Record<string, unknown> | null = null,
  nextAction: NextAction | null = null,
): BadRequestException {
  return new BadRequestException(errorBody(code, message, details, nextAction));
}

export function notFound(
  code: string,
  message: string,
  details: Record<string, unknown> | null = null,
  nextAction: NextAction | null = null,
): NotFoundException {
  return new NotFoundException(errorBody(code, message, details, nextAction));
}

export function conflict(
  code: string,
  message: string,
  details: Record<string, unknown> | null = null,
  nextAction: NextAction | null = null,
): ConflictException {
  return new ConflictException(errorBody(code, message, details, nextAction));
}