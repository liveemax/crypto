import { ScreenerAgent } from '../src/agents/screener.agent';
import { DEEP_VALUE_PROFILE, DEFAULT_PROFILE } from '../src/config/profiles';
import { StoreService } from '../src/core/store/store.service';
import { AgentContext, SnapshotRow } from '../src/core/types';
import { UniverseCandidate } from '../src/core/universe/universe.types';
import { EMPTY_TOKENOMICS } from '../src/core/tokenomics/tokenomics.constants';
import { ValidateService } from '../src/core/validate/validate.service';

const NOW = new Date().toISOString();

function candidate(overrides: Partial<UniverseCandidate> = {}): UniverseCandidate {
  return {
    ...EMPTY_TOKENOMICS,
    rank: 1, coingeckoId: 'aave', ticker: 'AAVE', name: 'Aave', priceUsd: 250,
    circulating: 15_000_000, totalSupply: 16_000_000, mcapCalcUsd: 3_750_000_000,
    mcapReportedUsd: 3_750_000_000, mcapDivergencePct: 0, fdvUsd: 4_000_000_000,
    vol24hUsd: 200_000_000, turnoverPct: 5.3, floatPct: 93.75, fdvToMcap: 1.07,
    marketSource: 'https://api.coingecko.com/api/v3/coins/markets', marketAsOf: NOW,
    defillamaSlugs: ['aave-v3'], sector: 'Lending', rawSectors: [], comparisonGroup: 'lending',
    assetArchetype: 'protocol', revenueState: 'available', matchedBy: 'gecko_id',
    tvlUsd: 20_000_000_000, tvlSource: 'https://defillama.com/protocol/aave-v3',
    fees12mUsd: 500_000_000, revenue12mUsd: 250_000_000, holdersRevenue12mUsd: 20_000_000,
    revenue30dUsd: 20_000_000, holdersRevenue30dUsd: 1_500_000,
    revenueBasis: 'reported_1y', revenueSource: 'https://defillama.com/protocol/aave-v3',
    sourceHealthy: true, holderYieldPct: 0.53, takeRatePct: 50, payoutRatioPct: 8,
    pRev: 15, pFees: 7.5, fdvRev: 16, revenuePerTvlPct: 1.25,
    tier: 'economics', passed: true, rejectedAt: null, rejectReason: null,
    ...overrides,
  };
}

function row(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    ticker: 'AAVE', name: 'Aave', sector: 'Lending', asOf: NOW, priceUsd: 250,
    mcapUsd: 3_750_000_000, fdvUsd: 4_000_000_000, vol24hUsd: 200_000_000,
    circulating: 15_000_000, totalSupply: 16_000_000, revenue1y: 250_000_000,
    revenue30d: 20_000_000, tvlUsd: 20_000_000_000,
    mcapSource: 'https://api.coingecko.com/api/v3/coins/markets',
    feesSource: 'https://defillama.com/protocol/aave-v3',
    tvlSource: 'https://defillama.com/protocol/aave-v3', errors: [],
    asOfMarket: NOW, asOfFees: NOW, asOfTvl: NOW, revenueBasis: 'reported_1y',
    ...overrides,
  };
}

describe('ScreenerAgent', () => {
  const store = { saveResult: jest.fn(async () => '/tmp/result.json') } as unknown as StoreService;
  const agent = new ScreenerAgent(new ValidateService(), store);

  beforeEach(() => jest.clearAllMocks());

  it('берёт готовые числа кандидата, объясняет проверки и основание выручки', async () => {
    const item = candidate();
    const ctx: AgentContext = { snapshot: [], candidate: item, profile: DEFAULT_PROFILE };
    const result = await agent.run('AAVE', row(), ctx);

    expect(result.score).toBe(75);
    expect(result.verdict).toMatchObject({ passed: true, failedChecks: [], revenueBasis: 'reported_1y', takeRatePct: 50 });
    expect(result.metrics.pRev.value).toBe(15);
    expect(Object.values(result.metrics).every((metric) => Boolean(metric.sourceUrl))).toBe(true);
  });

  it('порог maxPRev профиля меняет балл и причины отказа', async () => {
    const item = candidate({ pRev: 12 });
    const base = await agent.run('AAVE', row(), {
      snapshot: [], candidate: item, profile: DEFAULT_PROFILE,
    });
    const result = await agent.run('AAVE', row(), {
      snapshot: [], candidate: item, profile: DEEP_VALUE_PROFILE,
    });

    expect(base.score).toBe(80);
    expect(result.score).toBe(20);
    expect(result.verdict).toMatchObject({ passed: true, failedChecks: [] });
  });

  it('для pool без выручки не выдумывает ноль и оставляет объяснение', async () => {
    const item = candidate({ tier: 'pool', revenueState: 'source_missing', revenue12mUsd: null, pRev: null, fdvRev: null });
    const result = await agent.run('POOL', row({ revenue1y: null }), { snapshot: [], candidate: item, profile: DEFAULT_PROFILE });

    expect(result.score).toBeNull();
    expect(result.missing).toContain('revenue12mUsd');
    expect(result.notes).toContain('балл не рассчитан');
  });

  it('НЕГАТИВНЫЙ: отсутствие финансового источника обнуляет метрики и снижает балл', async () => {
    const item = candidate({ revenueSource: null });
    const result = await agent.run('AAVE', row({ feesSource: null }), { snapshot: [], candidate: item, profile: DEFAULT_PROFILE });

    expect(result.metrics.revenue12mUsd).toMatchObject({ value: null, droppedReason: 'no_source' });
    expect(result.metrics.pRev).toMatchObject({ value: null, droppedReason: 'no_source' });
    expect(result.missing).toEqual(expect.arrayContaining(['revenue12mUsd', 'pRev']));
    expect(result.dataQuality).toBe(3 / 8);
    expect(result.scoreRaw).toBe(75);
    expect(result.score).toBe(51.6);
  });
});
