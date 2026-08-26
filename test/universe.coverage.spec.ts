import { COVERAGE } from '../src/config/coverage';
import { buildCoverage } from '../src/core/universe/coverage';
import { emptyFilterState } from '../src/core/universe/filter-state.service';
import type { UniverseCandidate } from '../src/core/universe/universe.types';

function candidate(overrides: Partial<UniverseCandidate> = {}): UniverseCandidate {
  return {
    rank: 1,
    coingeckoId: 'aave',
    ticker: 'AAVE',
    name: 'Aave',
    priceUsd: 100,
    circulating: 1_000_000,
    totalSupply: 1_200_000,
    mcapCalcUsd: 100_000_000,
    mcapReportedUsd: 100_000_000,
    mcapDivergencePct: 0,
    fdvUsd: 120_000_000,
    vol24hUsd: 10_000_000,
    turnoverPct: 10,
    floatPct: 83,
    fdvToMcap: 1.2,
    marketSource: 'https://api.coingecko.com/api/v3/coins/markets',
    marketAsOf: '2026-08-26T08:00:00.000Z',
    defillamaSlugs: ['aave-v3'],
    sector: 'lending',
    rawSectors: [],
    comparisonGroup: 'lending',
    assetArchetype: 'protocol',
    revenueState: 'available',
    matchedBy: 'gecko_id',
    tvlUsd: 1_000_000_000,
    tvlSource: 'https://defillama.com/protocol/aave-v3',
    fees12mUsd: 20_000_000,
    revenue12mUsd: 10_000_000,
    holdersRevenue12mUsd: 5_000_000,
    revenue30dUsd: 800_000,
    holdersRevenue30dUsd: 400_000,
    revenueBasis: 'reported_1y',
    revenueSource: 'https://defillama.com/protocol/aave-v3',
    sourceHealthy: true,
    holderYieldPct: 5,
    takeRatePct: 50,
    payoutRatioPct: 50,
    pRev: 10,
    pFees: 5,
    fdvRev: 12,
    revenuePerTvlPct: 1,
    tier: 'yield',
    passed: true,
    rejectedAt: null,
    rejectReason: null,
    ...overrides,
  };
}

const context = {
  universeVersion: '2026-08-26',
  builtAt: '2026-08-26T08:00:00.000Z',
  activeFilters: emptyFilterState(),
};

function withGroup(count: number): UniverseCandidate[] {
  return Array.from({ length: count }, (_, index) =>
    candidate({ coingeckoId: `ok-${index}`, ticker: `OK${index}` }),
  );
}

describe('Покрытие групп сравнения', () => {
  it('считает долю по числу и по капитализации раздельно', () => {
    const report = buildCoverage(
      [
        ...withGroup(19),
        candidate({
          coingeckoId: 'monero',
          ticker: 'XMR',
          comparisonGroup: null,
          assetArchetype: 'other',
          sector: null,
          matchedBy: 'none',
          revenueState: 'mapping_failed',
          mcapCalcUsd: 8_000_000_000,
        }),
      ],
      context,
    );

    expect(report.total).toBe(20);
    expect(report.sector.withoutGroup).toBe(1);
    expect(report.sector.gapPct).toBe(5);
    // Одна монета из двадцати — но 81% денег. Одного порога не хватило бы.
    expect(report.sector.gapMcapPct).toBeGreaterThan(80);
    expect(report.sector.worst[0].ticker).toBe('XMR');
  });

  it('НЕГАТИВНЫЙ: превышение любого порога делает гейт красным', () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      candidate({
        coingeckoId: `gap-${index}`,
        ticker: `GAP${index}`,
        comparisonGroup: null,
        mcapCalcUsd: 1_000,
      }),
    );

    // Провал по числу при мизерной доле капитализации.
    const byCount = buildCoverage([...withGroup(70), ...many], context);
    expect(byCount.sector.gapPct).toBeGreaterThan(COVERAGE.maxSectorGapPct);
    expect(byCount.sector.gapMcapPct).toBeLessThan(COVERAGE.maxSectorGapMcapPct);
    expect(byCount.sector.passed).toBe(false);
    expect(byCount.warnings.some((line) => line.includes('ГЕЙТ'))).toBe(true);

    // Провал только по деньгам: одна монета из ста, но половина капитализации.
    const byMcap = buildCoverage(
      [
        ...withGroup(99),
        candidate({ coingeckoId: 'whale', ticker: 'WHALE', comparisonGroup: null,
          mcapCalcUsd: 50_000_000_000 }),
      ],
      context,
    );
    expect(byMcap.sector.gapPct).toBeLessThan(COVERAGE.maxSectorGapPct);
    expect(byMcap.sector.gapMcapPct).toBeGreaterThan(COVERAGE.maxSectorGapMcapPct);
    expect(byMcap.sector.passed).toBe(false);
  });

  it('разделяет подтверждённый ноль и отсутствие данных', () => {
    const report = buildCoverage(
      [
        candidate({ coingeckoId: 'morpho', ticker: 'MORPHO', revenueState: 'known_zero' }),
        candidate({ coingeckoId: 'ltc', ticker: 'LTC', assetArchetype: 'chain',
          comparisonGroup: 'layer-1', revenueState: 'unsupported_business_model' }),
        candidate({ coingeckoId: 'xmr', ticker: 'XMR', revenueState: 'mapping_failed' }),
        candidate(),
      ],
      context,
    );

    const states = new Map(report.revenue.byState.map((item) => [item.key, item.count]));
    expect(states.get('known_zero')).toBe(1);
    expect(states.get('unsupported_business_model')).toBe(1);
    expect(states.get('mapping_failed')).toBe(1);
    expect(states.get('available')).toBe(1);
    expect(report.revenue.gated).toBe(false);
    expect(report.warnings.some((line) => line.includes('валидаторам') || line.includes('майнеров'))).toBe(true);
  });

  it('НЕГАТИВНЫЙ: снимок без поля группы не даёт зелёный гейт', () => {
    // Ровно тот баг, что дал 0% пробелов на непересобранной вселенной.
    const legacy = withGroup(20).map((item) => {
      const copy: Partial<UniverseCandidate> = { ...item };
      delete copy.comparisonGroup;
      delete copy.assetArchetype;
      return copy as UniverseCandidate;
    });

    const report = buildCoverage(legacy, context);

    expect(report.sector.withoutGroup).toBe(20);
    expect(report.sector.gapPct).toBe(100);
    expect(report.sector.passed).toBe(false);
    expect(report.warnings.some((line) => line.includes('СТАРОГО ФОРМАТА'))).toBe(true);
    // Ключ бакета не должен исчезать из JSON.
    expect(report.archetypes.every((item) => typeof item.key === 'string')).toBe(true);
  });

  it('пустая база не делит на ноль', () => {
    const report = buildCoverage([], context);
    expect(report.sector.gapPct).toBe(0);
    expect(report.sector.passed).toBe(true);
  });
});