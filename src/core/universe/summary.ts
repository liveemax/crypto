import type { AlphaDecision, AlphaStatus } from './alpha.types';
import type { AssetArchetype, DataState } from './comparison.types';
import type { TokenomicsDataState } from '../tokenomics/tokenomics.types';
import type { CandidateView, Tier } from './universe.types';

/**
 * Компактная строка списка. Тяжёлое здесь не «сокращено», а выброшено целиком:
 * percentiles, peers, склейка и сырые категории читаются по одному токену в
 * GET /universe/{token}, а не пятьюдесятью штуками сразу в браузере.
 */
export interface UniverseSummaryRow {
  rank: number;
  coingeckoId: string;
  ticker: string;
  name: string;
  sector: string | null;
  comparisonGroup: string | null;
  assetArchetype: AssetArchetype;

  mcapCalcUsd: number | null;
  vol24hUsd: number | null;
  turnoverPct: number | null;
  floatPct: number | null;
  tvlUsd: number | null;

  revenue12mUsd: number | null;
  holdersRevenue12mUsd: number | null;
  holderYieldPct: number | null;
  pRev: number | null;
  pFees: number | null;

  overhangPct: number | null;
  unlock12mPct: number | null;
  netHolderYieldPct: number | null;

  revenueState: DataState;
  tokenomicsState: TokenomicsDataState;

  tier: Tier;
  passed: boolean;
  rejectedAt: string | null;
  rejectReason: string | null;

  /** Место в нише числом. Сами перцентили — в view=full. */
  alphaDecision: AlphaDecision | null;
  alphaStatus: AlphaStatus | null;
  alphaQualified: boolean | null;
  businessScaleScore: number | null;
  rankInSector: number | null;
  sectorSize: number | null;
  tvlRank: number | null;
  revenueRank: number | null;
  tvlRanked: number | null;
  revenueRanked: number | null;
  tvlSharePct: number | null;
  revenueSharePct: number | null;
}

export function summaryOf(candidate: CandidateView): UniverseSummaryRow {
  return {
    rank: candidate.rank,
    coingeckoId: candidate.coingeckoId,
    ticker: candidate.ticker,
    name: candidate.name,
    sector: candidate.sector,
    comparisonGroup: candidate.comparisonGroup,
    assetArchetype: candidate.assetArchetype,

    mcapCalcUsd: candidate.mcapCalcUsd,
    vol24hUsd: candidate.vol24hUsd,
    turnoverPct: candidate.turnoverPct,
    floatPct: candidate.floatPct,
    tvlUsd: candidate.tvlUsd,

    revenue12mUsd: candidate.revenue12mUsd,
    holdersRevenue12mUsd: candidate.holdersRevenue12mUsd,
    holderYieldPct: candidate.holderYieldPct,
    pRev: candidate.pRev,
    pFees: candidate.pFees,

    overhangPct: candidate.overhangPct,
    unlock12mPct: candidate.unlock12mPct,
    netHolderYieldPct: candidate.netHolderYieldPct,

    revenueState: candidate.revenueState,
    tokenomicsState: candidate.tokenomicsState,

    tier: candidate.tier,
    passed: candidate.passed,
    rejectedAt: candidate.rejectedAt,
    rejectReason: candidate.rejectReason,

    alphaDecision: candidate.alpha?.decision ?? null,
    alphaStatus: candidate.alpha?.alphaStatus ?? null,
    alphaQualified: candidate.alpha?.alphaQualified ?? null,
    businessScaleScore: candidate.alpha?.businessScaleScore ?? null,
    rankInSector: candidate.alpha?.rankInSector ?? null,
    sectorSize: candidate.alpha?.sectorSize ?? null,
    tvlRank: candidate.alpha?.tvlRank ?? null,
    revenueRank: candidate.alpha?.revenueRank ?? null,
    tvlRanked: candidate.alpha?.tvlRanked ?? null,
    revenueRanked: candidate.alpha?.revenueRanked ?? null,
    tvlSharePct: candidate.alpha?.tvlSharePct ?? null,
    revenueSharePct: candidate.alpha?.revenueSharePct ?? null,
  };
}
