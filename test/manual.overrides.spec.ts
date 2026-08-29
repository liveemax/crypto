import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EMPTY_TOKENOMICS } from '../src/core/tokenomics/tokenomics.constants';
import { FilterStateService } from '../src/core/universe/filter-state.service';
import { JobService } from '../src/core/jobs/job.service';
import { ManualService } from '../src/core/manual/manual.service';
import { StoreService } from '../src/core/store/store.service';
import { UniverseBuilder } from '../src/core/universe/universe.builder';
import { UniverseFilter } from '../src/core/universe/universe.filter';
import { UniverseService } from '../src/core/universe/universe.service';
import type { UniverseCandidate, UniverseSnapshot } from '../src/core/universe/universe.types';

function candidate(overrides: Partial<UniverseCandidate> = {}): UniverseCandidate {
  return {
    ...EMPTY_TOKENOMICS,
    rank: 1,
    coingeckoId: 'aave',
    ticker: 'AAVE',
    name: 'Aave',
    priceUsd: 128.92,
    circulating: 15_000_000,
    totalSupply: 16_000_000,
    mcapCalcUsd: 1_933_800_000,
    mcapReportedUsd: 1_933_800_000,
    mcapDivergencePct: 0,
    fdvUsd: 2_062_000_000,
    vol24hUsd: 438_000_000,
    marketSource: 'https://api.coingecko.com/api/v3/coins/markets',
    marketAsOf: '2026-08-25T10:00:00.000Z',
    turnoverPct: 22.03,
    floatPct: 96.4,
    fdvToMcap: 1.04,
    defillamaSlugs: ['aave-v3'],
    sector: 'lending',
    rawSectors: [],
    comparisonGroup: 'lending',
    assetArchetype: 'protocol',
    revenueState: 'available',
    matchedBy: 'gecko_id',
    tvlUsd: 17_000_000_000,
    tvlSource: 'https://defillama.com/protocol/aave-v3',
    fees12mUsd: 120_000_000,
    revenue12mUsd: 107_000_000,
    holdersRevenue12mUsd: 40_000_000,
    revenue30dUsd: 9_000_000,
    holdersRevenue30dUsd: 3_000_000,
    revenueBasis: 'reported_1y',
    revenueSource: 'https://defillama.com/protocol/aave-v3',
    sourceHealthy: true,
    holderYieldPct: 2.07,
    takeRatePct: 89,
    payoutRatioPct: 37,
    pRev: 18.5,
    pFees: 16.1,
    fdvRev: 19.3,
    revenuePerTvlPct: 0.63,
    tier: 'yield',
    passed: false,
    rejectedAt: null,
    rejectReason: null,
    ...overrides,
  };
}

/** Тот же снимок, что резолвит вселенная: DUP встречается у двух разных активов. */
function population(): UniverseCandidate[] {
  return [
    candidate(),
    candidate({ rank: 2, coingeckoId: 'wrapped-x', ticker: 'DUP', name: 'Wrapped X' }),
    candidate({ rank: 3, coingeckoId: 'wrapped-y', ticker: 'DUP', name: 'Wrapped Y' }),
  ];
}

function fakeStore(snapshot: UniverseSnapshot | null): StoreService {
  const state = new Map<string, unknown>();
  return {
    loadSnapshot: jest.fn().mockResolvedValue(snapshot),
    loadState: jest.fn().mockImplementation(async (name: string) => state.get(name) ?? null),
    saveState: jest.fn().mockImplementation(async (name: string, value: unknown) => {
      state.set(name, value);
      return `/tmp/${name}.json`;
    }),
  } as unknown as StoreService;
}

function buildManual(snapshot: UniverseSnapshot | null): ManualService {
  const store = fakeStore(snapshot);
  const filters = new FilterStateService(store);
  const universe = new UniverseService(
    store,
    {} as UniverseBuilder,
    new UniverseFilter(),
    new JobService(),
    filters,
  );
  return new ManualService(store, universe);
}

const VALID_INPUT = {
  incentives12mUsd: 1_200_000,
  sourceUrl: 'https://official.example/report',
  asOf: '2026-08-01T00:00:00.000Z',
};

describe('ManualService: override стимулов с provenance (шаг 14.1)', () => {
  it('сохраняет override и читает его как один объект по ticker и coingeckoId', async () => {
    const manual = buildManual({
      version: '2026-08-25',
      builtAt: '2026-08-25T06:00:00.000Z',
      topN: 3,
      sources: {},
      candidates: population(),
      excludedIds: [],
      warnings: [],
    });

    const saved = await manual.setIncentiveOverride('AAVE', VALID_INPUT);
    expect(saved).toEqual({
      ...VALID_INPUT,
      coingeckoId: 'aave',
      ticker: 'AAVE',
      origin: 'manual',
      createdAt: expect.any(String),
    });

    await expect(manual.incentiveOverride('aave')).resolves.toEqual({
      coingeckoId: 'aave',
      ticker: 'AAVE',
      override: saved,
    });
    await expect(manual.incentiveOverride('AAVE')).resolves.toEqual({
      coingeckoId: 'aave',
      ticker: 'AAVE',
      override: saved,
    });
  });

  it('подтверждённый ноль сохраняется и отличается от отсутствующей записи', async () => {
    const manual = buildManual({
      version: '2026-08-25',
      builtAt: '2026-08-25T06:00:00.000Z',
      topN: 3,
      sources: {},
      candidates: population(),
      excludedIds: [],
      warnings: [],
    });

    await expect(manual.incentiveOverride('AAVE')).resolves.toEqual({
      coingeckoId: 'aave',
      ticker: 'AAVE',
      override: null,
    });

    const saved = await manual.setIncentiveOverride('AAVE', { ...VALID_INPUT, incentives12mUsd: 0 });
    expect(saved.incentives12mUsd).toBe(0);
    await expect(manual.incentiveOverride('AAVE')).resolves.toEqual({
      coingeckoId: 'aave',
      ticker: 'AAVE',
      override: saved,
    });
  });

  it('повторная запись заменяет предыдущую: детерминированный replace без дублей', async () => {
    const manual = buildManual({
      version: '2026-08-25',
      builtAt: '2026-08-25T06:00:00.000Z',
      topN: 3,
      sources: {},
      candidates: population(),
      excludedIds: [],
      warnings: [],
    });

    await manual.setIncentiveOverride('AAVE', VALID_INPUT);
    const second = await manual.setIncentiveOverride('AAVE', {
      ...VALID_INPUT,
      incentives12mUsd: 2_500_000,
      sourceUrl: 'https://official.example/report-2',
    });

    const read = await manual.incentiveOverride('AAVE');
    expect(read.override).toEqual(second);
    expect(read.override?.incentives12mUsd).toBe(2_500_000);
  });

  it('НЕГАТИВНЫЙ: без sourceUrl запись отклоняется как BadRequestException', async () => {
    const manual = buildManual({
      version: '2026-08-25',
      builtAt: '2026-08-25T06:00:00.000Z',
      topN: 3,
      sources: {},
      candidates: population(),
      excludedIds: [],
      warnings: [],
    });

    await expect(
      manual.setIncentiveOverride('AAVE', { ...VALID_INPUT, sourceUrl: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('НЕГАТИВНЫЙ: с неверным asOf запись отклоняется как BadRequestException', async () => {
    const manual = buildManual({
      version: '2026-08-25',
      builtAt: '2026-08-25T06:00:00.000Z',
      topN: 3,
      sources: {},
      candidates: population(),
      excludedIds: [],
      warnings: [],
    });

    await expect(
      manual.setIncentiveOverride('AAVE', { ...VALID_INPUT, asOf: 'не-дата' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('НЕГАТИВНЫЙ: отрицательный incentives12mUsd отклоняется как BadRequestException', async () => {
    const manual = buildManual({
      version: '2026-08-25',
      builtAt: '2026-08-25T06:00:00.000Z',
      topN: 3,
      sources: {},
      candidates: population(),
      excludedIds: [],
      warnings: [],
    });

    await expect(
      manual.setIncentiveOverride('AAVE', { ...VALID_INPUT, incentives12mUsd: -1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('НЕГАТИВНЫЙ: неоднозначный тикер отвечает ConflictException со списком coingeckoId', async () => {
    const manual = buildManual({
      version: '2026-08-25',
      builtAt: '2026-08-25T06:00:00.000Z',
      topN: 3,
      sources: {},
      candidates: population(),
      excludedIds: [],
      warnings: [],
    });

    await expect(manual.setIncentiveOverride('DUP', VALID_INPUT)).rejects.toBeInstanceOf(
      ConflictException,
    );
    try {
      await manual.incentiveOverride('DUP');
      throw new Error('ожидалось исключение');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      const response = (error as ConflictException).getResponse() as {
        details: { candidates: Array<{ coingeckoId: string }> };
      };
      expect(response.details.candidates.map((item) => item.coingeckoId).sort()).toEqual([
        'wrapped-x',
        'wrapped-y',
      ]);
    }
  });

  it('НЕГАТИВНЫЙ: неизвестный токен отвечает NotFoundException', async () => {
    const manual = buildManual({
      version: '2026-08-25',
      builtAt: '2026-08-25T06:00:00.000Z',
      topN: 3,
      sources: {},
      candidates: population(),
      excludedIds: [],
      warnings: [],
    });

    await expect(manual.incentiveOverride('NOPE')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('НЕГАТИВНЫЙ: без собранной вселенной override сохранить нельзя', async () => {
    const manual = buildManual(null);

    await expect(manual.setIncentiveOverride('AAVE', VALID_INPUT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
