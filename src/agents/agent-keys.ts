import { createHash } from 'node:crypto';
import type { AnalysisProfile } from '../core/universe/profile.types';

/**
 * Отпечаток профиля для ключа кэша. Балл кодового агента считается по порогам
 * профиля: результат другого профиля — чужое число, а не то же самое.
 */
export function profileHash(profile: AnalysisProfile): string {
  return createHash('sha1').update(stableJson(profile)).digest('hex').slice(0, 12);
}

/**
 * Имя файла для хранилища. StoreService отвергает недопустимые символы
 * исключением, и тикер вроде `$MOG` уронил бы весь прогон ради строки кэша.
 */
export function fileKey(ticker: string): string {
  const safe = ticker.trim().replace(/[^a-zA-Z0-9._-]/g, '-');
  return safe.length === 0 || safe === '.' || safe === '..' ? 'unknown' : safe;
}

/** Порядок ключей объекта отпечаток менять не должен, порядок массива — должен. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}