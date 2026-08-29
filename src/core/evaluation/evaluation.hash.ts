import { createHash } from 'node:crypto';
import type { ActiveFilterState } from '../universe/filter-state.types';
import type { AlphaConfig, AnalysisProfile } from '../universe/profile.types';
import type { UniverseCandidate } from '../universe/universe.types';
import type { EvaluationInputHashes } from './evaluation.types';
import { BUSINESS_SCALE_FORMULA_VERSION } from './evaluation.constants';

/** Факты, от которых зависит только покомпонентный результат tokenomics. */
const TOKENOMICS_FACT_FIELDS = [
  'floatPct',
  'overhangPct',
  'unlock12mPct',
  'netHolderYieldPct',
  'holderYieldPct',
  'nextUnlockUsd',
  'nextUnlockAt',
  'nextUnlockCostInDailyVolumes',
  'tokenomicsState',
  'marketSource',
  'tokenomicsSource',
  'marketAsOf',
  'asOfTokenomics',
] as const;

const COMPARATIVE_FACT_FIELDS = [
  'mcapCalcUsd',
  'tvlUsd',
  'fees12mUsd',
  'revenue12mUsd',
  'holdersRevenue12mUsd',
  'holderYieldPct',
  'payoutRatioPct',
  'pRev',
  'pFees',
  'fdvRev',
  'revenuePerTvlPct',
  'marketSource',
  'tvlSource',
  'revenueSource',
  'marketAsOf',
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
  const tokenomicsFacts = [...input.universe]
    .sort((left, right) => left.coingeckoId.localeCompare(right.coingeckoId))
    .map((candidate) => [
      candidate.coingeckoId,
      ...TOKENOMICS_FACT_FIELDS.map((field) => candidate[field] ?? null),
    ]);

  const perToken = digest({
    universeVersion: input.universeVersion,
    builtAt: input.builtAt,
    tokenomicsFormulaVersion: 'absolute-overhang-v1',
    facts: tokenomicsFacts,
  });

  const comparative = digest({
    facts: [...input.selection]
      .sort((left, right) => left.coingeckoId.localeCompare(right.coingeckoId))
      .map((candidate) => [
        candidate.coingeckoId,
        candidate.comparisonGroup ?? null,
        ...COMPARATIVE_FACT_FIELDS.map((field) => candidate[field] ?? null),
      ]),
    profileId: input.profile.id,
    thresholds: input.profile.thresholds,
    valuation: input.profile.valuation,
    rankBy: input.rankBy,
    activeFilters: input.activeFilters,
    formulaVersions: {
      businessScale: BUSINESS_SCALE_FORMULA_VERSION,
      valuation: input.profile.valuation.formulaVersion,
    },
  });

  return { perToken, comparative };
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}
