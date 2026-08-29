import {
  capPenalty,
  HIGH_TURNOVER_PCT,
  ILLIQUID_TURNOVER_PCT,
  riskFlagsOf,
  RISK_FLAG_PENALTY,
  RISK_FLAG_PENALTY_CAP,
} from '../src/core/evaluation/risk-flags';
import type { RiskFlag } from '../src/core/evaluation/evaluation.types';
import type { ManualIncentiveOverrideRecord } from '../src/core/manual/manual.types';
import { EMPTY_TOKENOMICS } from '../src/core/tokenomics/tokenomics.constants';
import type { UniverseCandidate } from '../src/core/universe/universe.types';

const NOW = new Date().toISOString();

function candidate(overrides: Partial<UniverseCandidate> = {}): UniverseCandidate {
  return {
    ...EMPTY_TOKENOMICS,
    rank: 1,
    coingeckoId: 'base',
    ticker: 'BASE',
    name: 'Base Exchange',
    priceUsd: 10,
    circulating: 20_000_000,
    totalSupply: 25_000_000,
    mcapCalcUsd: 200_000_000,
    mcapReportedUsd: 200_000_000,
    mcapDivergencePct: 0,
    fdvUsd: 250_000_000,
    vol24hUsd: 20_000_000,
    turnoverPct: 10,
    floatPct: 80,
    fdvToMcap: 1.25,
    marketSource: 'https://api.coingecko.com/api/v3/coins/markets',
    marketAsOf: NOW,
    defillamaSlugs: ['base'],
    sector: 'dexs',
    rawSectors: [],
    comparisonGroup: 'dexs',
    assetArchetype: 'protocol',
    revenueState: 'available',
    matchedBy: 'gecko_id',
    tvlUsd: 1_000_000_000,
    tvlSource: 'https://defillama.com/protocol/base',
    fees12mUsd: 40_000_000,
    revenue12mUsd: 20_000_000,
    holdersRevenue12mUsd: 10_000_000,
    revenue30dUsd: 1_600_000,
    holdersRevenue30dUsd: 800_000,
    revenueBasis: 'reported_1y',
    revenueSource: 'https://defillama.com/protocol/base',
    sourceHealthy: true,
    holderYieldPct: 5,
    takeRatePct: 50,
    payoutRatioPct: 50,
    pRev: 10,
    pFees: 5,
    fdvRev: 12.5,
    revenuePerTvlPct: 2,
    tier: 'yield',
    passed: true,
    rejectedAt: null,
    rejectReason: null,
    ...overrides,
  };
}

function override(overrides: Partial<ManualIncentiveOverrideRecord> = {}): ManualIncentiveOverrideRecord {
  return {
    incentives12mUsd: 5_000_000,
    sourceUrl: 'https://official.example/incentives-report',
    asOf: NOW,
    coingeckoId: 'base',
    ticker: 'BASE',
    origin: 'manual',
    createdAt: NOW,
    ...overrides,
  };
}

describe('ШАГ 14.2: кодовые флаги риска', () => {
  describe('оборот: high_turnover / illiquid', () => {
    it('оборот выше 50% даёт high_turnover с тем же числом в тексте', () => {
      const result = riskFlagsOf(candidate({ turnoverPct: 63.4 }), null);

      expect(result.flags).toHaveLength(1);
      const flag = result.flags[0];
      expect(flag.id).toBe('high_turnover');
      expect(flag.value).toBe(63.4);
      expect(flag.penalty).toBe(RISK_FLAG_PENALTY);
      expect(flag.label).toContain('63.4');
      expect(flag.metric).toMatchObject({
        value: 63.4,
        sourceUrl: 'https://api.coingecko.com/api/v3/coins/markets',
        asOf: NOW,
        unit: '%',
      });
      expect(result.penalty).toBe(RISK_FLAG_PENALTY);
    });

    it('ровно 50 не срабатывает: граница строго больше', () => {
      const result = riskFlagsOf(candidate({ turnoverPct: HIGH_TURNOVER_PCT }), null);
      expect(result.flags.find((item) => item.id === 'high_turnover')).toBeUndefined();
    });

    it('оборот ниже 0.5% даёт illiquid с тем же числом в тексте', () => {
      const result = riskFlagsOf(candidate({ turnoverPct: 0.12 }), null);

      expect(result.flags).toHaveLength(1);
      const flag = result.flags[0];
      expect(flag.id).toBe('illiquid');
      expect(flag.value).toBe(0.12);
      expect(flag.penalty).toBe(RISK_FLAG_PENALTY);
      expect(flag.label).toContain('0.12');
    });

    it('ровно 0.5 не срабатывает: граница строго меньше', () => {
      const result = riskFlagsOf(candidate({ turnoverPct: ILLIQUID_TURNOVER_PCT }), null);
      expect(result.flags.find((item) => item.id === 'illiquid')).toBeUndefined();
    });

    it('неизвестный оборот не создаёт флага и уходит в missing', () => {
      const result = riskFlagsOf(candidate({ turnoverPct: null }), null);
      expect(result.flags.find((item) => item.id === 'high_turnover' || item.id === 'illiquid')).toBeUndefined();
      expect(result.missing).toContain('turnoverPct');
    });
  });

  describe('экономика после стимулов', () => {
    it('без override стимулы неизвестны: флага нет, ноль не подставляется', () => {
      // Отрицательная revenue здесь — не реальный сценарий, а способ доказать,
      // что при неизвестном override флаг не срабатывает даже когда подстановка
      // нуля дала бы отрицательный результат.
      const result = riskFlagsOf(candidate({ revenue12mUsd: -500 }), null);

      expect(result.flags.find((item) => item.id === 'negative_after_incentives')).toBeUndefined();
      expect(result.missing).toContain('incentives12mUsd');
      expect(result.missing).not.toContain('revenue12mUsd');
    });

    it('override есть, revenue неизвестна: revenue12mUsd уходит в missing, а не incentives12mUsd', () => {
      const result = riskFlagsOf(candidate({ revenue12mUsd: null }), override());

      expect(result.flags.find((item) => item.id === 'negative_after_incentives')).toBeUndefined();
      expect(result.missing).toContain('revenue12mUsd');
      expect(result.missing).not.toContain('incentives12mUsd');
    });

    it('revenue минус стимулы отрицательна: флаг с provenance override и тем же числом', () => {
      const result = riskFlagsOf(
        candidate({ revenue12mUsd: 3_000_000 }),
        override({ incentives12mUsd: 8_000_000, sourceUrl: 'https://official.example/report', asOf: NOW }),
      );

      expect(result.flags).toHaveLength(1);
      const flag = result.flags[0];
      expect(flag.id).toBe('negative_after_incentives');
      expect(flag.value).toBe(-5_000_000);
      expect(flag.label).toContain('-5000000');
      expect(flag.penalty).toBe(RISK_FLAG_PENALTY);
      expect(flag.metric).toMatchObject({
        value: 8_000_000,
        sourceUrl: 'https://official.example/report',
        asOf: NOW,
        unit: 'USD',
      });
    });

    it('revenue минус стимулы равна нулю — не отрицательно, флага нет', () => {
      const result = riskFlagsOf(
        candidate({ revenue12mUsd: 5_000_000 }),
        override({ incentives12mUsd: 5_000_000 }),
      );
      expect(result.flags.find((item) => item.id === 'negative_after_incentives')).toBeUndefined();
    });

    it('revenue минус стимулы положительна: флага нет', () => {
      const result = riskFlagsOf(
        candidate({ revenue12mUsd: 20_000_000 }),
        override({ incentives12mUsd: 1_000_000 }),
      );
      expect(result.flags).toHaveLength(0);
    });
  });

  describe('потолок штрафа', () => {
    it('два одновременных флага дают сумму штрафов без превышения потолка', () => {
      const result = riskFlagsOf(
        candidate({ turnoverPct: 90, revenue12mUsd: 1_000_000 }),
        override({ incentives12mUsd: 9_000_000 }),
      );

      expect(result.flags.map((item) => item.id).sort()).toEqual(
        ['high_turnover', 'negative_after_incentives'].sort(),
      );
      expect(result.penalty).toBe(2 * RISK_FLAG_PENALTY);
    });

    it('три флага по 10 всё равно дают штраф 20, а не 30', () => {
      const synthetic: RiskFlag[] = [
        { id: 'high_turnover', label: 'a', value: 1, penalty: 10, metric: { value: 1, unit: '%', sourceUrl: null, asOf: null } },
        { id: 'illiquid', label: 'b', value: 1, penalty: 10, metric: { value: 1, unit: '%', sourceUrl: null, asOf: null } },
        { id: 'negative_after_incentives', label: 'c', value: -1, penalty: 10, metric: { value: -1, unit: 'USD', sourceUrl: null, asOf: null } },
      ];
      expect(capPenalty(synthetic)).toBe(RISK_FLAG_PENALTY_CAP);
    });

    it('один флаг не капается искусственно', () => {
      const result = riskFlagsOf(candidate({ turnoverPct: 90 }), null);
      expect(result.penalty).toBe(RISK_FLAG_PENALTY);
    });

    it('ни один флаг не сработал — штраф ноль', () => {
      const result = riskFlagsOf(candidate(), override({ incentives12mUsd: 1 }));
      expect(result.flags).toHaveLength(0);
      expect(result.penalty).toBe(0);
    });
  });
});
