import { applyTokenomics, overhangPctOf } from '../src/core/tokenomics/tokenomics.calc';
import { EMPTY_TOKENOMICS } from '../src/core/tokenomics/tokenomics.constants';
import type { TokenomicsSnapshot } from '../src/core/tokenomics/tokenomics.types';
import type { UniverseCandidate } from '../src/core/universe/universe.types';

const NOW = Date.parse('2026-08-27T00:00:00.000Z');

function candidate(overrides: Partial<UniverseCandidate> = {}): UniverseCandidate {
  return {
    ...EMPTY_TOKENOMICS,
    coingeckoId: 'arbitrum',
    ticker: 'ARB',
    circulating: 5_000_000_000,
    totalSupply: 10_000_000_000,
    priceUsd: 0.4,
    vol24hUsd: 123_000_000,
    holderYieldPct: 0.5,
    mcapCalcUsd: 2_000_000_000,
    ...overrides,
  } as unknown as UniverseCandidate;
}

function facts(overrides: Partial<TokenomicsSnapshot['facts'][number]> = {}): TokenomicsSnapshot {
  return {
    universeVersion: '2026-08-26',
    collectedAt: '2026-08-26T06:00:00.000Z',
    provider: 'defillama-emissions',
    documentsScanned: 370,
    warnings: [],
    facts: [
      {
        coingeckoId: 'arbitrum',
        ticker: 'ARB',
        provider: 'defillama-emissions',
        providerId: 'arbitrum',
        matchedBy: 'coingecko_id',
        state: 'available',
        events: [
          {
            date: '2026-09-16T00:00:00.000Z',
            tokens: 100_000_000,
            category: 'team',
            origin: 'provider',
            sourceUrl: 'https://defillama.com/unlocks/arbitrum',
            asOf: '2026-08-26T04:12:07.000Z',
          },
        ],
        streams: [],
        tbdPct: 0,
        schedulePct: 100,
        includesForecast: false,
        sourceUrl: 'https://defillama.com/unlocks/arbitrum',
        asOf: '2026-08-26T04:12:07.000Z',
        note: 'arbitrum',
        ...overrides,
      },
    ],
  };
}

describe('Производные числа токеномики', () => {
  it('навес null, а не отрицательный, когда totalSupply ниже circulating', () => {
    expect(overhangPctOf(1_000, 900)).toBeNull();
    expect(overhangPctOf(1_000, 2_000)).toBe(100);
  });

  it('пересчитывает проценты по новому circulating, а не хранит их из прошлого прогона', () => {
    const before = applyTokenomics([candidate()], facts(), NOW).candidates[0];
    const after = applyTokenomics(
      [candidate({ circulating: 10_000_000_000 } as Partial<UniverseCandidate>)],
      facts(),
      NOW,
    ).candidates[0];

    expect(before?.unlock12mPct).toBe(2);
    expect(after?.unlock12mPct).toBe(1);
    // asOf остаётся временем источника: пересчёт нашей арифметики его не двигает.
    expect(after?.asOfTokenomics).toBe('2026-08-26T04:12:07.000Z');
  });

  it('NHY не считается по одной половине', () => {
    const noYield = applyTokenomics(
      [candidate({ holderYieldPct: null } as Partial<UniverseCandidate>)],
      facts(),
      NOW,
    ).candidates[0];

    expect(noYield?.unlock12mPct).toBe(2);
    expect(noYield?.netHolderYieldPct).toBeNull();
  });

  it('отказ источника не превращается в ноль разлоков', () => {
    const result = applyTokenomics([candidate()], facts({ state: 'matched_unparsed' }), NOW);
    const row = result.candidates[0];

    expect(row?.tokenomicsState).toBe('matched_unparsed');
    expect(row?.unlock12mPct).toBeNull();
    expect(row?.netHolderYieldPct).toBeNull();
    // Навес не зависит от чужих адаптеров и остаётся известным.
    expect(row?.overhangPct).toBe(100);
  });

  it('измеренный ноль даёт ноль, а не пробел', () => {
    const result = applyTokenomics([candidate()], facts({ state: 'known_zero', events: [] }), NOW);
    const row = result.candidates[0];

    expect(row?.unlock12mPct).toBe(0);
    expect(row?.netHolderYieldPct).toBe(0.5);
  });

  it('поток с нулевым терминатором обрывается, а не течёт до конца года', () => {
    const end = new Date(NOW + 365 * 86_400_000).toISOString();
    const stream = (tokensPerWeek: number, startsAt: string) => ({
      recipient: 'Team',
      category: 'team' as const,
      startsAt,
      endsAt: end,
      tokensPerWeek,
      origin: 'provider' as const,
      sourceUrl: 'https://defillama.com/unlocks/arbitrum',
      asOf: '2026-08-26T04:12:07.000Z',
    });
    const row = applyTokenomics(
      [candidate()],
      facts({
        events: [],
        streams: [
          stream(70_000_000, new Date(NOW).toISOString()),
          stream(0, new Date(NOW + 100 * 86_400_000).toISOString()),
        ],
      }),
      NOW,
    ).candidates[0];

    // Сто дней по 10 млн в день — это 20% от 5 млрд, а не 73% за полный год.
    expect(row?.unlock12mPct).toBe(20);
  });

  it('стоимость ближайшего разлока считается в дневных объёмах', () => {
    const row = applyTokenomics([candidate()], facts(), NOW).candidates[0];

    expect(row?.nextUnlockUsd).toBe(40_000_000);
    expect(row?.nextUnlockCostInDailyVolumes).toBe(0.33);
  });
});