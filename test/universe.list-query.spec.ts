import { DEFAULT_PROFILE } from '../src/config/profiles';
import { EMPTY_TOKENOMICS } from '../src/core/tokenomics/tokenomics.constants';
import { FilterStateService } from '../src/core/universe/filter-state.service';
import { JobService } from '../src/core/jobs/job.service';
import { StoreService } from '../src/core/store/store.service';
import { UniverseBuilder } from '../src/core/universe/universe.builder';
import { UniverseFilter } from '../src/core/universe/universe.filter';
import { UniverseService } from '../src/core/universe/universe.service';
import type { ActiveFilterState } from '../src/core/universe/filter-state.types';
import type { UniverseCandidate, UniverseSnapshot } from '../src/core/universe/universe.types';

function candidate(overrides: Partial<UniverseCandidate> = {}): UniverseCandidate {
  return {
    ...EMPTY_TOKENOMICS,
    rank: 1,
    coingeckoId: 'aave',
    ticker: 'AAVE',
    name: 'Aave',
    priceUsd: 100,
    circulating: 1_000_000,
    totalSupply: 1_000_000,
    mcapCalcUsd: 100_000_000,
    mcapReportedUsd: 100_000_000,
    mcapDivergencePct: 0,
    fdvUsd: 100_000_000,
    vol24hUsd: 1_000_000,
    turnoverPct: 1,
    floatPct: 100,
    fdvToMcap: 1,
    marketSource: 'https://api.coingecko.com/api/v3/coins/markets',
    marketAsOf: '2026-08-29T00:00:00.000Z',
    defillamaSlugs: ['aave-v3'],
    sector: 'Lending',
    rawSectors: [],
    comparisonGroup: 'lending',
    assetArchetype: 'protocol',
    revenueState: 'available',
    matchedBy: 'gecko_id',
    tvlUsd: 1_000_000,
    tvlSource: 'https://defillama.com/protocol/aave-v3',
    fees12mUsd: 1_000_000,
    revenue12mUsd: 1_000_000,
    holdersRevenue12mUsd: 500_000,
    revenue30dUsd: 80_000,
    holdersRevenue30dUsd: 40_000,
    revenueBasis: 'reported_1y',
    revenueSource: 'https://defillama.com/protocol/aave-v3',
    sourceHealthy: true,
    holderYieldPct: 5,
    takeRatePct: 50,
    payoutRatioPct: 50,
    pRev: 10,
    pFees: 5,
    fdvRev: 10,
    revenuePerTvlPct: 5,
    tier: 'yield',
    passed: true,
    rejectedAt: null,
    rejectReason: null,
    ...overrides,
  };
}

function population(): UniverseCandidate[] {
  return [
    candidate({ rank: 1, coingeckoId: 'aave', ticker: 'AAVE', name: 'Aave', sector: 'Lending', mcapCalcUsd: 300 }),
    candidate({
      rank: 2,
      coingeckoId: 'uniswap',
      ticker: 'UNI',
      name: 'Uniswap',
      sector: 'dexs',
      mcapCalcUsd: 500,
    }),
    candidate({
      rank: 3,
      coingeckoId: 'no-sector',
      ticker: 'NOSEC',
      name: 'No Sector Coin',
      sector: null,
      mcapCalcUsd: null,
    }),
  ];
}

function snapshotOf(candidates: UniverseCandidate[]): UniverseSnapshot {
  return {
    version: '2026-08-29',
    builtAt: '2026-08-29T06:00:00.000Z',
    topN: candidates.length,
    sources: {},
    candidates,
    excludedIds: [],
    warnings: [],
  };
}

/** default-профиль включён: рейтинг market_known реально отсеивает без mcap. */
function enabledDefaultScreen(): Partial<ActiveFilterState> {
  return {
    screen: { enabled: true, profileId: 'default', profile: DEFAULT_PROFILE },
    alpha: { enabled: false, profileId: null, config: null },
  };
}

describe('ШАГ 1.1/1.2: UniverseService.list() и .options()', () => {
  let snapshot: UniverseSnapshot;
  let store: StoreService;
  let service: UniverseService;

  beforeEach(() => {
    snapshot = snapshotOf(population());
    store = {
      loadSnapshot: jest.fn(async () => snapshot),
      loadState: jest.fn(async () => null),
    } as unknown as StoreService;
    service = new UniverseService(
      store,
      {} as unknown as UniverseBuilder,
      new UniverseFilter(),
      new JobService(),
      new FilterStateService(store),
    );
  });

  it('q ищет по name/ticker/coingeckoId без учёта регистра и до пагинации', async () => {
    const page = await service.list({ passedOnly: false, q: 'UNI' });
    expect(page.pagination.total).toBe(1);
    expect((page.items[0] as { ticker: string }).ticker).toBe('UNI');
  });

  it('пустая строка q после trim равна отсутствующему фильтру', async () => {
    const page = await service.list({ passedOnly: false, q: '   ' });
    expect(page.pagination.total).toBe(3);
  });

  it('passedOnly=false возвращает и прошедших, и отсеянных с rejectReason', async () => {
    // market_known отсеивает по-настоящему только при включённом screen: без него
    // compose() зовёт passAll() и сбрасывает любой заранее заданный reject.
    const screenedStore = {
      loadSnapshot: jest.fn(async () => snapshot),
      loadState: jest.fn(async () => enabledDefaultScreen()),
    } as unknown as StoreService;
    const screenedService = new UniverseService(
      screenedStore,
      {} as unknown as UniverseBuilder,
      new UniverseFilter(),
      new JobService(),
      new FilterStateService(screenedStore),
    );

    const passedOnly = await screenedService.list({ passedOnly: true });
    expect(passedOnly.pagination.total).toBe(2);

    const all = await screenedService.list({ passedOnly: false });
    expect(all.pagination.total).toBe(3);
    const rejected = all.items.find((item) => (item as { ticker: string }).ticker === 'NOSEC') as {
      passed: boolean;
      rejectedAt: string | null;
      rejectReason: string | null;
    };
    expect(rejected.passed).toBe(false);
    expect(rejected.rejectedAt).toBe('market_known');
    expect(rejected.rejectReason).toBeTruthy();
  });

  it('null в mcapCalcUsd всегда в конце — и при asc, и при desc', async () => {
    const desc = await service.list({ passedOnly: false, sort: 'mcapCalcUsd', order: 'desc' });
    expect(desc.items.map((item) => (item as { coingeckoId: string }).coingeckoId)).toEqual([
      'uniswap',
      'aave',
      'no-sector',
    ]);

    const asc = await service.list({ passedOnly: false, sort: 'mcapCalcUsd', order: 'asc' });
    expect(asc.items.map((item) => (item as { coingeckoId: string }).coingeckoId)).toEqual([
      'aave',
      'uniswap',
      'no-sector',
    ]);
  });

  it('без явного order действует дефолт поля: rank — asc', async () => {
    const page = await service.list({ passedOnly: false, sort: 'rank' });
    expect(page.items.map((item) => (item as { rank: number }).rank)).toEqual([1, 2, 3]);
  });

  it('одинаковые запросы дают одинаковый порядок', async () => {
    const first = await service.list({ passedOnly: false, sort: 'mcapCalcUsd' });
    const second = await service.list({ passedOnly: false, sort: 'mcapCalcUsd' });
    expect(first.items).toEqual(second.items);
  });

  it('options() строится по всей вселенной, не по passed и не по странице; null исключён', async () => {
    const options = await service.options();
    expect(options.sectors).toEqual(['dexs', 'lending']);
    expect(options.context.universeVersion).toBe('2026-08-29');
  });
});
