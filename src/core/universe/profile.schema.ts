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
  })
  .refine(
    (config) =>
      config.rankBy.length === 2 &&
      config.rankBy[0]?.field === 'tvlUsd' &&
      config.rankBy[0]?.direction === 'higher_better' &&
      config.rankBy[1]?.field === 'revenue12mUsd' &&
      config.rankBy[1]?.direction === 'higher_better' &&
      config.minRankedValues === 3 &&
      config.minScoreMetrics === 2,
    {
      message:
        'Business scale фиксирован: tvlUsd и revenue12mUsd (0.50/0.50), обе оси обязательны, минимум значений — 3',
    },
  );

const valuationFields = [
  'pRev', 'pFees', 'fdvRev', 'holderYieldPct', 'revenuePerTvlPct',
] as const;

const valuationConfigSchema = z
  .object({
    rankBy: z.array(z.object({
      field: z.enum(valuationFields),
      direction: z.enum(['higher_better', 'lower_better']),
      weight: z.number().finite().positive(),
    }).strict()).length(valuationFields.length),
    minRankedValues: z.literal(3),
    minScoreMetrics: z.number().int().min(2),
    minAvailableWeight: z.number().min(0).max(1),
    formulaVersion: z.string().trim().min(1),
  })
  .strict()
  .superRefine((config, context) => {
    const fields = config.rankBy.map((item) => item.field);
    if (new Set(fields).size !== valuationFields.length || valuationFields.some((field) => !fields.includes(field))) {
      context.addIssue({ code: 'custom', message: 'valuation.rankBy должен содержать каждую ось ровно один раз' });
    }
    const expected = { pRev: ['lower_better', 0.4], pFees: ['lower_better', 0.2], fdvRev: ['lower_better', 0.2], holderYieldPct: ['higher_better', 0.1], revenuePerTvlPct: ['higher_better', 0.1] } as const;
    for (const item of config.rankBy) {
      const rule = expected[item.field];
      if (item.direction !== rule[0] || Math.abs(item.weight - rule[1]) > 1e-9) {
        context.addIssue({ code: 'custom', message: `Неверные направление или вес valuation для ${item.field}` });
      }
    }
    const total = config.rankBy.reduce((sum, item) => sum + item.weight, 0);
    if (Math.abs(total - 1) > 1e-9) context.addIssue({ code: 'custom', message: 'Сумма весов valuation.rankBy должна быть равна 1' });
  });

/** Проверяет разовую конфигурацию альфы из тела POST /universe/alpha. */
export function parseAlphaConfig(value: unknown): AlphaConfig {
  return alphaConfigSchema.parse(dropUndefined(value)) as AlphaConfig;
}

/**
 * Три точных ключа композита. Object.strict() отклоняет и недостачу, и лишний
 * четвёртый ключ вроде вернувшегося mechanism — свободный Record такого не умеет.
 */
const weightsSchema = z
  .object({
    tokenomics: z.number().finite().nonnegative(),
    valuation: z.number().finite().nonnegative(),
    sectorPosition: z.number().finite().nonnegative(),
  })
  .strict()
  .refine(
    (weights) => Math.abs(weights.tokenomics + weights.valuation + weights.sectorPosition - 1) < 1e-9,
    { message: 'Сумма весов tokenomics + valuation + sectorPosition должна быть равна 1' },
  );

const profileSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]*$/),
    title: z.string().trim().min(1),
    rationale: z.string().trim().min(1),
    screen: z.array(screenRuleSchema).min(1),
    alpha: alphaConfigSchema,
    valuation: valuationConfigSchema,
    thresholds: z.object({
      minMcapUsd: z.number().finite().nonnegative(),
      minAnnualRevenueUsd: z.number().finite().nonnegative(),
      maxPRev: z.number().finite().nonnegative(),
    }),
    codeEvaluations: z
      .array(z.enum(['valuation', 'tokenomics', 'sectorPosition']))
      .min(1),
    weights: weightsSchema,
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
