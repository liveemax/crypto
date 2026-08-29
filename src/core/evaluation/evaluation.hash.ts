import { createHash } from 'node:crypto';
import type { ActiveFilterState } from '../universe/filter-state.types';
import type { AlphaConfig, AnalysisProfile } from '../universe/profile.types';
import type { UniverseCandidate } from '../universe/universe.types';
import type { EvaluationInputHashes } from './evaluation.types';

/** Числа, от которых зависит результат по одному токену. */
const FACT_FIELDS = [
  'mcapCalcUsd',
  'fdvUsd',
  'tvlUsd',
  'fees12mUsd',
  'revenue12mUsd',
  'holdersRevenue12mUsd',
  'holderYieldPct',
  'takeRatePct',
  'payoutRatioPct',
  'pRev',
  'pFees',
  'fdvRev',
  'revenuePerTvlPct',
  'floatPct',
  'fdvToMcap',
  'overhangPct',
  'unlock12mPct',
  'netHolderYieldPct',
  'tokenomicsState',
  'marketAsOf',
  'asOfTokenomics',
] as const;

export interface HashInput {
  universeVersion: string;
  builtAt: string;
  profile: AnalysisProfile;
  /** Весь снимок: иначе смена фильтра меняла бы perToken и обесценивала прогон. */
  universe: readonly UniverseCandidate[];
  selection: readonly UniverseCandidate[];
  activeFilters: ActiveFilterState;
  rankBy: AlphaConfig;
}

/**
 * Считает совместимость покомпонентно. Один хеш на прогон делал бы любую
 * подвижку фильтра поводом пересчитать всё и объявить рейтинг несовместимым.
 */
export function inputHashes(input: HashInput): EvaluationInputHashes {
  const facts = [...input.universe]
    .sort((left, right) => left.coingeckoId.localeCompare(right.coingeckoId))
    .map((candidate) => [
      candidate.coingeckoId,
      ...FACT_FIELDS.map((field) => candidate[field] ?? null),
    ]);

  const perToken = digest({
    universeVersion: input.universeVersion,
    builtAt: input.builtAt,
    profileId: input.profile.id,
    thresholds: input.profile.thresholds,
    valuation: input.profile.valuation,
    facts,
  });

  const comparative = digest({
    perToken,
    rankBy: input.rankBy,
    alphaEnabled: input.activeFilters.alpha.enabled,
    members: [...input.selection]
      .map((candidate) => `${candidate.coingeckoId}:${candidate.comparisonGroup ?? '-'}`)
      .sort(),
  });

  return { perToken, comparative };
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}