import type { ResponseContext } from '../envelope.types';
import type { CandidateEvaluation } from '../evaluation/evaluation.types';
import type { AlphaDecision } from '../universe/alpha.types';
import type { AssetArchetype, DataState } from '../universe/comparison.types';
import type { TokenomicsDataState } from '../tokenomics/tokenomics.types';

export interface TokenIdentity {
  coingeckoId: string;
  ticker: string;
  name: string;
  rank: number;
  sector: string | null;
  comparisonGroup: string | null;
  assetArchetype: AssetArchetype;
  matchedBy: string;
}

export interface TokenPresence {
  inSnapshot: boolean;
  /** Заполнено, только когда токена в снимке нет: почему именно. */
  absenceReason: string | null;
  screen: { enabled: boolean; passed: boolean; stage: string | null; reason: string | null };
  alpha: {
    enabled: boolean;
    /**
     * Видела ли альфа эту строку. Без этого поля decision: null значит три
     * разных вещи: фильтр выключен, строку убрал screen раньше, сравнение было.
     */
    applied: boolean;
    decision: AlphaDecision | null;
    reason: string | null;
    rankInSector: number | null;
    sectorSize: number | null;
  };
  inActiveSelection: boolean;
}

/** Числа группами: у каждой группы своя ссылка и своя дата источника. */
export interface TokenFactGroup {
  sourceUrl: string | null;
  asOf: string | null;
  values: Record<string, number | string | null>;
}

export interface TokenReport {
  context: ResponseContext;
  identity: TokenIdentity | null;
  presence: TokenPresence;
  facts: { market: TokenFactGroup; revenue: TokenFactGroup; tokenomics: TokenFactGroup } | null;
  dataStates: {
    revenue: DataState | null;
    tokenomics: TokenomicsDataState | null;
    comparisonGroup: 'available' | 'source_missing' | null;
  };
  evaluationStatus: 'evaluated' | 'not_in_selection' | 'no_run';
  evaluation: CandidateEvaluation | null;
  /** Что именно нужно сделать, чтобы картинка изменилась. */
  whatWouldChangeThis: string[];
}