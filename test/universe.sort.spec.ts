import { EMPTY_TOKENOMICS } from '../src/core/tokenomics/tokenomics.constants';
import { comparator, defaultOrderFor } from '../src/core/universe/sort';
import type { CandidateView, UniverseCandidate } from '../src/core/universe/universe.types';

function base(overrides: Partial<UniverseCandidate> = {}): UniverseCandidate {
  return {
    ...EMPTY_TOKENOMICS,
    rank: 1,
    coingeckoId: 'aave',
    ticker: 'AAVE',
    name: 'Aave',
    priceUsd: null,
    circulating: null,
    totalSupply: null,
    mcapCalcUsd: null,
    mcapReportedUsd: null,
    mcapDivergencePct: null,
    fdvUsd: null,
    vol24hUsd: null,
    turnoverPct: null,
    floatPct: null,
    fdvToMcap: null,
    marketSource: null,
    marketAsOf: null,
    defillamaSlugs: [],
    sector: null,
    rawSectors: [],
    comparisonGroup: null,
    assetArchetype: 'protocol',
    revenueState: 'available',
    matchedBy: 'none',
    tvlUsd: null,
    tvlSource: null,
    fees12mUsd: null,
    revenue12mUsd: null,
    holdersRevenue12mUsd: null,
    revenue30dUsd: null,
    holdersRevenue30dUsd: null,
    revenueBasis: 'none',
    revenueSource: null,
    sourceHealthy: true,
    holderYieldPct: null,
    takeRatePct: null,
    payoutRatioPct: null,
    pRev: null,
    pFees: null,
    fdvRev: null,
    revenuePerTvlPct: null,
    tier: 'pool',
    passed: true,
    rejectedAt: null,
    rejectReason: null,
    ...overrides,
  };
}

function view(
  overrides: Partial<UniverseCandidate> = {},
  businessScaleScore: number | null = null,
): CandidateView {
  return {
    ...base(overrides),
    alpha:
      businessScaleScore === null
        ? null
        : ({ businessScaleScore } as unknown as CandidateView['alpha']),
  };
}

describe('ШАГ 1.1: comparator и default order', () => {
  it('rank, pRev и pFees сортируются по возрастанию по умолчанию, остальные метрики — по убыванию', () => {
    expect(defaultOrderFor('rank')).toBe('asc');
    expect(defaultOrderFor('pRev')).toBe('asc');
    expect(defaultOrderFor('pFees')).toBe('asc');
    expect(defaultOrderFor('mcapCalcUsd')).toBe('desc');
    expect(defaultOrderFor('holderYieldPct')).toBe('desc');
    expect(defaultOrderFor('businessScaleScore')).toBe('desc');
  });

  it('null всегда в конце — и при asc, и при desc', () => {
    const withValue = view({ coingeckoId: 'known', pRev: 10 });
    const withoutValue = view({ coingeckoId: 'unknown', pRev: null });

    const asc = [withoutValue, withValue].sort(comparator('pRev', 'asc'));
    expect(asc.map((c) => c.coingeckoId)).toEqual(['known', 'unknown']);

    const desc = [withoutValue, withValue].sort(comparator('pRev', 'desc'));
    expect(desc.map((c) => c.coingeckoId)).toEqual(['known', 'unknown']);
  });

  it('оба null стабилизируются по rank, затем coingeckoId', () => {
    const a = view({ coingeckoId: 'zzz', rank: 2, pRev: null });
    const b = view({ coingeckoId: 'aaa', rank: 1, pRev: null });
    expect([a, b].sort(comparator('pRev', 'desc')).map((c) => c.coingeckoId)).toEqual(['aaa', 'zzz']);
  });

  it('равные значения решаются rank, затем coingeckoId — исходный массив не мутируется', () => {
    const rows = [
      view({ coingeckoId: 'zzz', rank: 5, mcapCalcUsd: 100 }),
      view({ coingeckoId: 'aaa', rank: 5, mcapCalcUsd: 100 }),
      view({ coingeckoId: 'mmm', rank: 1, mcapCalcUsd: 100 }),
    ];
    const before = [...rows];
    const sorted = [...rows].sort(comparator('mcapCalcUsd', 'desc'));
    expect(sorted.map((c) => c.coingeckoId)).toEqual(['mmm', 'aaa', 'zzz']);
    expect(rows).toEqual(before);
  });

  it('businessScaleScore читается из alpha-решения, а не с самого кандидата', () => {
    const leader = view({ coingeckoId: 'leader' }, 90);
    const laggard = view({ coingeckoId: 'laggard' }, 10);
    const noDecision = view({ coingeckoId: 'no-alpha' }, null);

    const sorted = [noDecision, laggard, leader].sort(comparator('businessScaleScore', 'desc'));
    expect(sorted.map((c) => c.coingeckoId)).toEqual(['leader', 'laggard', 'no-alpha']);
  });

  it('order=asc разворачивает направление метрики, а не тай-брейк', () => {
    const low = view({ coingeckoId: 'low', holderYieldPct: 1 });
    const high = view({ coingeckoId: 'high', holderYieldPct: 5 });
    expect(
      [high, low].sort(comparator('holderYieldPct', 'asc')).map((c) => c.coingeckoId),
    ).toEqual(['low', 'high']);
  });
});
