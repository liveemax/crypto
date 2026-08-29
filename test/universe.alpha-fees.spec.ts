import { DEFAULT_PROFILE } from '../src/config/profiles';
import { applyAlpha, businessScalePositions } from '../src/core/universe/alpha';
import type { CandidateView } from '../src/core/universe/universe.types';

function member(ticker: string, tvlUsd: number | null, revenue12mUsd: number | null, patch: Partial<CandidateView> = {}): CandidateView {
  return {
    coingeckoId: ticker.toLowerCase(), ticker, name: ticker,
    comparisonGroup: 'dexs', assetArchetype: 'protocol', sector: 'dexs',
    rawSectors: [], matchedBy: 'gecko_id', revenueState: 'available',
    tvlUsd, revenue12mUsd, tvlSource: 'https://defillama.com/protocol/test',
    revenueSource: 'https://defillama.com/protocol/test',
    marketAsOf: '2026-08-29T00:00:00.000Z', sourceHealthy: true,
    passed: true, tier: 'pool', rejectedAt: null, rejectReason: null, alpha: null,
    ...patch,
  } as unknown as CandidateView;
}

describe('Единый business scale', () => {
  it('ранжирует LARGE первым, исключает NOSRC и требует обе оси', () => {
    const rows = [
      member('LARGE', 1_000, 1_000), member('MID', 700, 700), member('SMALL', 400, 400),
      member('FOUR', 300, 300), member('FIVE', 200, 200), member('SIX', 100, 100),
      member('NOSRC', 10_000, 10_000, { tvlSource: null, revenueSource: null }),
      member('MISSING_AXIS', null, 900),
    ];
    const positions = businessScalePositions(rows, DEFAULT_PROFILE.alpha);

    expect(positions.get('large')).toMatchObject({ rankInSector: 1, businessScaleScore: 100, alphaQualified: true });
    expect(positions.get('nosrc')).toMatchObject({ businessScaleScore: null, alphaStatus: 'insufficient_data' });
    expect(positions.get('missing_axis')).toMatchObject({ businessScaleScore: null, alphaQualified: false });
    expect(positions.get('large')?.percentiles.map((axis) => axis.ranked)).toEqual([6, 7]);

    const outcome = applyAlpha(rows, DEFAULT_PROFILE.alpha);
    expect(rows.find((row) => row.ticker === 'SIX')?.passed).toBe(false);
    expect(rows.find((row) => row.ticker === 'NOSRC')?.passed).toBe(true);
    expect(rows.find((row) => row.ticker === 'MISSING_AXIS')?.passed).toBe(true);
    expect(outcome.sectors[0]).toMatchObject({ ranked: 6, dropped: 1 });
  });

  it('не строит перцентиль и score по двум подтверждённым значениям', () => {
    const positions = businessScalePositions(
      [member('ONE', 2, 2), member('TWO', 1, 1)],
      DEFAULT_PROFILE.alpha,
    );
    expect(positions.get('one')?.percentiles.map((axis) => axis.percentile)).toEqual([null, null]);
    expect(positions.get('one')?.businessScaleScore).toBeNull();
  });

  it('в ненасыщенной нише не объявляет участника alpha-лидером', () => {
    const positions = businessScalePositions(
      [member('LARGE', 3, 3), member('MID', 2, 2), member('SMALL', 1, 1)],
      DEFAULT_PROFILE.alpha,
    );

    expect(positions.get('large')).toMatchObject({
      rankInSector: 1,
      alphaStatus: 'sector_not_saturated',
      alphaQualified: false,
    });
  });

  it('в ненасыщенной нише статус описывает отсутствие отбора даже без перцентилей', () => {
    const rows = [member('SKY', 3, 3)];
    const positions = businessScalePositions(rows, DEFAULT_PROFILE.alpha);

    expect(positions.get('sky')).toMatchObject({
      businessScaleScore: null,
      rankInSector: null,
      alphaStatus: 'sector_not_saturated',
      alphaQualified: false,
    });

    applyAlpha(rows, DEFAULT_PROFILE.alpha);
    expect(rows[0].alpha).toMatchObject({
      decision: 'sector_not_saturated',
      alphaStatus: 'sector_not_saturated',
      businessScaleScore: null,
    });
  });
});
