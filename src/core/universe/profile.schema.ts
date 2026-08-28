import { z } from 'zod';
import { NUMERIC_FIELDS } from './profile.types';
import type { AlphaConfig, AnalysisProfile } from './profile.types';

const compareRuleSchema = z
  .object({
    stage: z.string().trim().min(1),
    label: z.string().trim().min(1),
    kind: z.literal('compare'),
    field: z.enum(NUMERIC_FIELDS),
    op: z.enum(['gte', 'lte']),
    value: z.number().finite(),
    nullPolicy: z.enum(['pass', 'fail']),
  })
  .strict();

const namedRuleSchema = z
  .object({
    stage: z.string().trim().min(1),
    label: z.string().trim().min(1),
    kind: z.enum(['excluded', 'pegged', 'derivative', 'healthy']),
  })
  .strict();

const screenRuleSchema = z.discriminatedUnion('kind', [
  compareRuleSchema,
  namedRuleSchema,
]);

const alphaConfigSchema = z
  .object({
    perSector: z.number().int().positive(),
    minRankedValues: z.number().int().positive(),
    minScoreMetrics: z.number().int().positive(),
    rankBy: z
      .array(
        z.object({
          field: z.enum(NUMERIC_FIELDS),
          direction: z.enum(['higher_better', 'lower_better']),
        }),
      )
      .min(1),
  })
  .strict()
  .refine((config) => config.minScoreMetrics <= config.rankBy.length, {
    message: 'minScoreMetrics больше числа метрик: сравнимых участников не будет ни одного',
  });

/** Проверяет разовую конфигурацию альфы из тела POST /universe/alpha. */
export function parseAlphaConfig(value: unknown): AlphaConfig {
  return alphaConfigSchema.parse(dropUndefined(value)) as AlphaConfig;
}
const profileSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]*$/),
    title: z.string().trim().min(1),
    rationale: z.string().trim().min(1),
    screen: z.array(screenRuleSchema).min(1),
    alpha: alphaConfigSchema,
    thresholds: z.object({
      minMcapUsd: z.number().finite().nonnegative(),
      minAnnualRevenueUsd: z.number().finite().nonnegative(),
      maxPRev: z.number().finite().nonnegative(),
    }),
    codeEvaluations: z
      .array(z.enum(['valuation', 'tokenomics', 'sectorPosition']))
      .min(1),
    llmAgents: z.array(z.string().trim().min(1)),
    weights: z
      .record(z.string().trim().min(1), z.number().finite().nonnegative())
      .refine(
        (weights: Record<string, number>) =>
          Object.values(weights).some((weight) => weight > 0),
        { message: 'Хотя бы один вес должен быть больше нуля' },
      ),
    tierCuts: z
      .object({
        a: z.number().min(0).max(100),
        b: z.number().min(0).max(100),
        minDataQuality: z.number().min(0).max(1),
      })
      .refine(
        (cuts: { a: number; b: number; minDataQuality: number }) => cuts.a >= cuts.b,
        { message: 'Граница тира A должна быть не ниже границы B' },
      ),
  })
  .strict();

/**
 * Убирает ключи без значения. class-transformer материализует необязательные
 * поля DTO как undefined, strict-схема считает их лишними, и профиль, скачанный
 * из GET /config/profiles, не проходит валидацию собственного сервиса.
 *
 * Строгость сохраняется: настоящий лишний ключ приходит СО значением и будет
 * отклонён. Выбрасывается только артефакт трансформации.
 */
function dropUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropUndefined);
  if (value === null || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined) continue;
    result[key] = dropUndefined(item);
  }
  return result;
}

/** Проверяет разовый профиль и возвращает нормализованный контракт. */
export function parseAnalysisProfile(value: unknown): AnalysisProfile {
  return profileSchema.parse(dropUndefined(value)) as AnalysisProfile;
}