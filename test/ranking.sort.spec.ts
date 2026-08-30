import { defaultRankingOrderFor, rankingComparator } from '../src/core/ranking/ranking.sort';
import type { RankedCandidate, RankTier } from '../src/core/ranking/ranking.types';
import type { CandidateEvaluation, EvaluationBlock } from '../src/core/evaluation/evaluation.types';

function block(score: number | null): EvaluationBlock {
  return {
    component: 'valuation',
    title: 'Блок',
    verdict: {},
    score,
    metrics: {},
    dataQuality: 1,
    missing: [],
    notes: '',
  };
}

function ranked(overrides: {
  coingeckoId: string;
  name?: string;
  rankTier?: RankTier;
  composite?: number | null;
  dataQuality?: number;
  valuation?: number | null;
  tokenomics?: number | null;
  sectorPosition?: number | null;
}): RankedCandidate {
  const evaluation: CandidateEvaluation = {
    coingeckoId: overrides.coingeckoId,
    ticker: overrides.coingeckoId.toUpperCase(),
    name: overrides.name ?? overrides.coingeckoId,
    comparisonGroup: null,
    dataTier: 'yield',
    valuation: block(overrides.valuation ?? null),
    tokenomics: block(overrides.tokenomics ?? null),
    sectorPosition: block(overrides.sectorPosition ?? null),
    notEvaluated: [],
    riskFlags: [],
    flagPenalty: 0,
    riskMissing: [],
  };
  return {
    evaluation,
    rankTier: overrides.rankTier ?? 'B',
    compositeBase: overrides.composite ?? null,
    composite: overrides.composite ?? null,
    componentsUsed: [],
    weightSum: 1,
    compositeReason: null,
    dataQuality: overrides.dataQuality ?? 0.8,
    hardFilters: [],
    whatWouldChangeThis: [],
  };
}

describe('ШАГ 1.3: rankingComparator и дефолтный order', () => {
  it('tier и name — по возрастанию по умолчанию, баллы — по убыванию', () => {
    expect(defaultRankingOrderFor('tier')).toBe('asc');
    expect(defaultRankingOrderFor('name')).toBe('asc');
    expect(defaultRankingOrderFor('composite')).toBe('desc');
    expect(defaultRankingOrderFor('valuation')).toBe('desc');
    expect(defaultRankingOrderFor('dataQuality')).toBe('desc');
  });

  it('sort=tier по умолчанию: A → B → C → watchlist, внутри тира composite desc', () => {
    const rows = [
      ranked({ coingeckoId: 'w1', rankTier: 'watchlist', composite: null }),
      ranked({ coingeckoId: 'b-low', rankTier: 'B', composite: 40 }),
      ranked({ coingeckoId: 'a1', rankTier: 'A', composite: 90 }),
      ranked({ coingeckoId: 'b-high', rankTier: 'B', composite: 70 }),
    ];
    const sorted = [...rows].sort(rankingComparator('tier', 'asc'));
    expect(sorted.map((c) => c.evaluation.coingeckoId)).toEqual(['a1', 'b-high', 'b-low', 'w1']);
  });

  it('order=desc на sort=tier разворачивает порядок тиров, но не composite внутри тира', () => {
    const rows = [
      ranked({ coingeckoId: 'a1', rankTier: 'A', composite: 90 }),
      ranked({ coingeckoId: 'b-high', rankTier: 'B', composite: 70 }),
      ranked({ coingeckoId: 'b-low', rankTier: 'B', composite: 40 }),
      ranked({ coingeckoId: 'w1', rankTier: 'watchlist', composite: null }),
    ];
    const sorted = [...rows].sort(rankingComparator('tier', 'desc'));
    expect(sorted.map((c) => c.evaluation.coingeckoId)).toEqual(['w1', 'b-high', 'b-low', 'a1']);
  });

  it('composite: null всегда в конце, порядок ничьей — coingeckoId', () => {
    const rows = [
      ranked({ coingeckoId: 'zzz', composite: 50 }),
      ranked({ coingeckoId: 'no-composite', composite: null }),
      ranked({ coingeckoId: 'aaa', composite: 50 }),
    ];
    const sorted = [...rows].sort(rankingComparator('composite', 'desc'));
    expect(sorted.map((c) => c.evaluation.coingeckoId)).toEqual(['aaa', 'zzz', 'no-composite']);
  });

  it('name сортируется по алфавиту, ничья по coingeckoId', () => {
    const rows = [
      ranked({ coingeckoId: 'z', name: 'Zeta' }),
      ranked({ coingeckoId: 'a', name: 'Alpha' }),
    ];
    expect(
      [...rows].sort(rankingComparator('name', 'asc')).map((c) => c.evaluation.coingeckoId),
    ).toEqual(['a', 'z']);
  });

  it('valuation/tokenomics/sectorPosition читают соответствующий score блока', () => {
    const rows = [
      ranked({ coingeckoId: 'low', valuation: 20 }),
      ranked({ coingeckoId: 'high', valuation: 80 }),
      ranked({ coingeckoId: 'unknown', valuation: null }),
    ];
    expect(
      [...rows].sort(rankingComparator('valuation', 'desc')).map((c) => c.evaluation.coingeckoId),
    ).toEqual(['high', 'low', 'unknown']);
  });
});
