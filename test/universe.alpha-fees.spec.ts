import { DEFAULT_PROFILE } from '../src/config/profiles';
import { applyAlpha } from '../src/core/universe/alpha';
import type { CandidateView } from '../src/core/universe/universe.types';

/** Минимальный участник: заполнены только поля, которые читает альфа. */
function member(ticker: string, patch: Partial<CandidateView>): CandidateView {
  return {
    coingeckoId: ticker.toLowerCase(), ticker, name: ticker,
    comparisonGroup: 'layer-1', assetArchetype: 'chain', sector: 'chain',
    rawSectors: [], matchedBy: 'chain', revenueState: 'unsupported_business_model',
    mcapCalcUsd: 1_000_000_000, revenue12mUsd: null, holdersRevenue12mUsd: null,
    holderYieldPct: null, revenuePerTvlPct: null, pRev: null, tvlUsd: null,
    fees12mUsd: null, pFees: null, revenueSource: null, marketAsOf: null,
    passed: true, tier: 'pool', rejectedAt: null, rejectReason: null, alpha: null,
    ...patch,
  } as unknown as CandidateView;
}

describe('Ранжирование по комиссиям', () => {
  it('ниша, где у всех только комиссии, сравнима', () => {
    const members = [
      member('AAA', { fees12mUsd: 100_000_000, pFees: 4 }),
      member('BBB', { fees12mUsd: 50_000_000, pFees: 8 }),
      member('CCC', { fees12mUsd: 20_000_000, pFees: 20 }),
      member('DDD', { fees12mUsd: 10_000_000, pFees: 40 }),
      member('EEE', { fees12mUsd: 5_000_000, pFees: 60 }),
      member('FFF', { fees12mUsd: 1_000_000, pFees: 90 }),
    ];

    const out = applyAlpha(members, DEFAULT_PROFILE.alpha);
    const sector = out.sectors.find((item) => item.sector === 'layer-1');

    expect(sector?.ranked).toBe(6);
    expect(sector?.kept).toBe(5);
    expect(members.find((m) => m.ticker === 'AAA')?.alpha?.rankInSector).toBe(1);
    expect(members.find((m) => m.ticker === 'FFF')?.alpha?.decision).toBe('alpha_outranked');
  });

  it('участник с одними комиссиями сравнивается только по ним', () => {
    const members = [
      member('WITH', { fees12mUsd: 100_000_000, pFees: 4, revenue12mUsd: 50_000_000, pRev: 8 }),
      member('ONLY', { fees12mUsd: 60_000_000, pFees: 6 }),
      member('POOR', { fees12mUsd: 10_000_000, pFees: 30 }),
    ];
    applyAlpha(members, DEFAULT_PROFILE.alpha);

    const only = members.find((m) => m.ticker === 'ONLY')?.alpha;
    const revenue = only?.percentiles.find((p) => p.field === 'revenue12mUsd');
    const fees = only?.percentiles.find((p) => p.field === 'fees12mUsd');

    // Нет числа — нет перцентиля; ноль здесь означал бы худшего в нише.
    expect(revenue?.percentile).toBeNull();
    expect(revenue?.ranked).toBe(1);
    expect(fees?.percentile).not.toBeNull();
    expect(fees?.ranked).toBe(3);
    expect(only?.comparisonAvailable).toBe(true);
  });
});