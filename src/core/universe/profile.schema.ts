import { z } from 'zod';
import { NUMERIC_FIELDS } from './profile.types';
import type { AnalysisProfile } from './profile.types';

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

const profileSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]*$/),
    title: z.string().trim().min(1),
    rationale: z.string().trim().min(1),
    screen: z.array(screenRuleSchema).min(1),
    alpha: z.object({
      perSector: z.number().int().positive(),
      minSectorSize: z.number().int().positive(),
      includeTiers: z
        .array(z.enum(['yield', 'economics', 'pool', 'rejected']))
        .min(1),
      qualify: z.array(screenRuleSchema),
      rankBy: z
        .array(
          z.object({
            field: z.enum(NUMERIC_FIELDS),
            direction: z.enum(['higher_better', 'lower_better']),
          }),
        )
        .min(1),
      manualCandidates: z.array(screenRuleSchema),
    }),
    thresholds: z.object({
      minMcapUsd: z.number().finite().nonnegative(),
      minAnnualRevenueUsd: z.number().finite().nonnegative(),
      maxPRev: z.number().finite().nonnegative(),
    }),
    agents: z.array(z.string().trim().min(1)).min(1),
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

/** Проверяет разовый профиль и возвращает нормализованный контракт. */
export function parseAnalysisProfile(value: unknown): AnalysisProfile {
  return profileSchema.parse(value) as AnalysisProfile;
}
