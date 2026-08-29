import { ConflictException, NotFoundException } from '@nestjs/common';
import { JobService } from '../src/core/jobs/job.service';
import { StoreService } from '../src/core/store/store.service';
import { FilterStateService } from '../src/core/universe/filter-state.service';
import { UniverseBuilder } from '../src/core/universe/universe.builder';
import { UniverseFilter } from '../src/core/universe/universe.filter';
import { UniverseService } from '../src/core/universe/universe.service';
import { EvaluationService } from '../src/core/evaluation/evaluation.service';
import { ManualService } from '../src/core/manual/manual.service';
import { StatusService } from '../src/core/system/status.service';
import { TokenService } from '../src/core/system/token.service';
import { EMPTY_TOKENOMICS } from '../src/core/tokenomics/tokenomics.constants';
import type { UniverseCandidate, UniverseSnapshot } from '../src/core/universe/universe.types';

const NOW = new Date().toISOString();

function candidate(overrides: Partial<UniverseCandidate> = {}): UniverseCandidate {
  return {
    ...EMPTY_TOKENOMICS,
    rank: 1,
    coingeckoId: 'aave',
    ticker: 'AAVE',
    name: 'Aave',
    priceUsd: 250,
    circulating: 15_000_000,
    totalSupply: 16_000_000,
    mcapCalcUsd: 3_750_000_000,
    mcapReportedUsd: 3_750_000_000,
    mcapDivergencePct: 0,
    fdvUsd: 4_000_000_000,
    vol24hUsd: 200_000_000,
    turnoverPct: 5.33,
    floatPct: 93.75,
    fdvToMcap: 1.07,
    marketSource: 'https://api.coingecko.com/api/v3/coins/markets',
    marketAsOf: NOW,
    defillamaSlugs: ['aave-v3'],
    sector: 'lending',
    rawSectors: [],
    comparisonGroup: 'lending',
    assetArchetype: 'protocol',
    revenueState: 'available',
    matchedBy: 'gecko_id',
    tvlUsd: 20_000_000_000,
    tvlSource: 'https://defillama.com/protocol/aave-v3',
    fees12mUsd: 520_000_000,
    revenue12mUsd: 112_000_000,
    holdersRevenue12mUsd: 60_000_000,
    revenue30dUsd: 9_000_000,
    holdersRevenue30dUsd: 5_000_000,
    revenueBasis: 'reported_1y',
    revenueSource: 'https://defillama.com/protocol/aave-v3',
    sourceHealthy: true,
    holderYieldPct: 1.6,
    takeRatePct: 21.5,
    payoutRatioPct: 53.5,
    pRev: 33.5,
    pFees: 7.2,
    fdvRev: 35.7,
    revenuePerTvlPct: 0.56,
    overhangPct: 6.7,
    tokenomicsState: 'available',
    tokenomicsSource: 'https://defillama.com/unlocks/aave',
    asOfTokenomics: NOW,
    tier: 'yield',
    passed: true,
    rejectedAt: null,
    rejectReason: null,
    ...overrides,
  };
}

/** Полный, отсеиваемый, непокрытый календарём, без группы и тёзка по тикеру. */
function population(): UniverseCandidate[] {
  return [
    candidate(),
    candidate({
      rank: 2,
      coingeckoId: 'dead-token',
      ticker: 'DEAD',
      name: 'Dead Token',
      vol24hUsd: 1_000,
      turnoverPct: 0.0001,
    }),
    candidate({
      rank: 3,
      coingeckoId: 'monero',
      ticker: 'XMR',
      name: 'Monero',
      comparisonGroup: null,
      assetArchetype: 'chain',
      sector: null,
      matchedBy: 'none',
      revenueState: 'unsupported_business_model',
      revenue12mUsd: null,
      revenueSource: null,
      tokenomicsState: 'source_missing',
      tokenomicsSource: null,
      asOfTokenomics: null,
    }),
    // Ноль измерен и подтверждён: в очередь пробелов он попадать не должен.
    candidate({
      rank: 4,
      coingeckoId: 'zero-unlocks',
      ticker: 'ZERO',
      name: 'Zero Unlocks',
      tokenomicsState: 'known_zero',
      unlock12mPct: 0,
    }),
    candidate({ rank: 5, coingeckoId: 'twin-one', ticker: 'TWIN', name: 'Twin One' }),
    candidate({ rank: 6, coingeckoId: 'twin-two', ticker: 'TWIN', name: 'Twin Two' }),
    // Второй пробел, и он дороже XMR: без него очередь не проверяет ни страницу,
    // ни сортировку по деньгам, а фильтр по группе истинен на пустом массиве.
    candidate({
      rank: 7,
      coingeckoId: 'big-vesting',
      ticker: 'BIGV',
      name: 'Big Vesting',
      mcapCalcUsd: 12_000_000_000,
      tokenomicsState: 'matched_unparsed',
      tokenomicsSource: 'https://defillama.com/unlocks/big-vesting',
      unlock12mPct: null,
      netHolderYieldPct: null,
    }),
  ];
}

function snapshotOf(candidates: UniverseCandidate[]): UniverseSnapshot {
  return {
    version: '2026-08-26',
    builtAt: new Date().toISOString(),
    topN: candidates.length,
    sources: {},
    candidates,
    excludedIds: ['some-memecoin'],
    warnings: [],
  };
}

describe('Приёмка шага 11: удобный публичный API', () => {
  let snapshot: UniverseSnapshot;
  let filterState: { value: unknown };
  let runs: unknown[];
  let store: StoreService;
  let jobs: JobService;
  let universe: UniverseService;
  let evaluation: EvaluationService;

  beforeEach(() => {
    snapshot = snapshotOf(population());
    filterState = { value: null };
    runs = [];
    store = {
      loadSnapshot: jest.fn(async () => snapshot),
      saveSnapshot: jest.fn(async () => '/tmp/universe.json'),
      loadState: jest.fn(async () => filterState.value ?? null),
      saveState: jest.fn(async (_name: string, value: unknown) => {
        filterState.value = value;
        return '/tmp/active-filters.json';
      }),
      saveRun: jest.fn(async (_kind: string, _runId: string, value: unknown) => {
        runs.push(value);
        return '/tmp/run.json';
      }),
      loadRun: jest.fn(async () => runs.at(-1) ?? null),
    } as unknown as StoreService;

    jobs = new JobService();
    universe = new UniverseService(
      store,
      {} as unknown as UniverseBuilder,
      new UniverseFilter(),
      jobs,
      new FilterStateService(store),
    );
    const manual = {
      incentiveOverridesByCoingeckoId: jest.fn(async () => new Map()),
    } as unknown as ManualService;
    evaluation = new EvaluationService(store, universe, manual);
  });

  describe('GET /status', () => {
    it('показывает идущую задачу любого типа: владелец состояния один', async () => {
      jobs.begin('universe/tokenomics', 'tokenomics', 'Календарь разлоков');
      jobs.report({
        step: 'tokenomics',
        label: 'Обход документов эмиссий',
        current: 229,
        total: 370,
        loaded: 6,
        failed: false,
        error: null,
      });

      const report = await new StatusService(jobs, universe, evaluation).report();

      expect(report.job.operation).toBe('universe/tokenomics');
      expect(report.job.state).toBe('running');
      expect(report.job.percent).toBe(62);
      expect(report.nextAction.path).toBe('/status');
      // Тот же прогресс виден и в устаревшем алиасе: источник состояния один.
      expect((await universe.status()).state).toBe('running');
    });

    it('nextAction корректен в каждом состоянии', async () => {
      const status = new StatusService(jobs, universe, evaluation);

      (store.loadSnapshot as jest.Mock).mockResolvedValueOnce(null);
      (store.loadSnapshot as jest.Mock).mockResolvedValueOnce(null);
      expect((await status.report()).nextAction.path).toBe('/universe/refresh');

      // Числа свежие, календарь есть, оценки не было.
      expect((await status.report()).nextAction.path).toBe('/evaluation/run');

      await evaluation.run();
      const fresh = await status.report();
      expect(fresh.evaluation?.compatible).toEqual({ perToken: true, comparative: true });
      expect(fresh.nextAction.path).toBe('/evaluation/latest');

      // Сменили выборку: per-token числа те же, состав группы сравнения — нет.
      await universe.applyScreen({ enabled: true, profileId: 'default' });
      const moved = await status.report();
      expect(moved.evaluation?.compatible.perToken).toBe(true);
      expect(moved.evaluation?.compatible.comparative).toBe(false);
      expect(moved.nextAction.path).toBe('/evaluation/run');
    });

    it('покрытие календаря считается по полной вселенной, а не по выборке', async () => {
      const status = new StatusService(jobs, universe, evaluation);
      const before = (await status.report()).data.tokenomics.coveragePct;

      await universe.applyScreen({ enabled: true, profileId: 'default' });
      const after = (await status.report()).data.tokenomics.coveragePct;

      // Включённый фильтр не имеет права улучшать метрику покрытия.
      expect(after).toBe(before);
    });
  });

  describe('GET /universe/{token}', () => {
    it('объясняет присутствие и отсутствие, и оба раза это 200', async () => {
      await universe.applyScreen({ enabled: true, profileId: 'default' });
      const tokens = new TokenService(universe, evaluation);

      const present = await tokens.report('AAVE');
      expect(present.presence.inSnapshot).toBe(true);
      expect(present.presence.inActiveSelection).toBe(true);
      expect(present.facts?.revenue.sourceUrl).toContain('defillama.com');
      // У выручки своей даты нет: рядом со ссылкой едет marketAsOf того же прогона.
      expect(present.facts?.revenue.asOf).toBe(present.facts?.market.asOf);

      const rejected = await tokens.report('DEAD');
      expect(rejected.presence.inSnapshot).toBe(true);
      expect(rejected.presence.inActiveSelection).toBe(false);
      expect(rejected.presence.screen.stage).not.toBeNull();
      expect(rejected.whatWouldChangeThis.join(' ')).toContain('/universe/screen');

      // НЕГАТИВНЫЙ: включённая альфа без решения не выдаётся за состоявшееся сравнение.
      await universe.applyAlphaFilter({ enabled: true, profileId: 'default' });
      const snapped = await tokens.report('DEAD');
      expect(snapped.presence.alpha.enabled).toBe(true);
      expect(snapped.presence.alpha.applied).toBe(false);
      expect(snapped.presence.alpha.reason).toContain('снял screen');

      const compared = await tokens.report('AAVE');
      expect(compared.presence.alpha.applied).toBe(true);
      expect(compared.presence.alpha.decision).not.toBeNull();

      const absent = await tokens.report('НЕТТАКОГО');
      expect(absent.identity).toBeNull();
      expect(absent.presence.inSnapshot).toBe(false);
      expect(absent.presence.absenceReason).not.toBeNull();
    });

    it('НЕГАТИВНЫЙ: тикер не идентификатор — тёзки дают 409 со списком, а не выбор побольше', async () => {
      const tokens = new TokenService(universe, evaluation);

      await expect(tokens.report('TWIN')).rejects.toBeInstanceOf(ConflictException);
      // По coingeckoId неоднозначности нет: он и есть стабильный идентификатор.
      await expect(tokens.report('twin-one')).resolves.toMatchObject({
        identity: { coingeckoId: 'twin-one' },
      });
    });

    it('непокрытый календарь даёт задачу, а не ноль', async () => {
      const report = await new TokenService(universe, evaluation).report('XMR');

      expect(report.dataStates.tokenomics).toBe('source_missing');
      expect(report.facts?.tokenomics.values.unlock12mPct).toBeNull();
      expect(report.whatWouldChangeThis.join(' ')).toContain('/manual/unlocks');
    });
  });

  describe('GET /universe/data-gaps', () => {
    it('очередь типизирована, отсортирована по деньгам и знает свой полный размер', async () => {
      const page = await universe.dataGaps({ limit: 1 });

      expect(page.pagination.total).toBeGreaterThan(1);
      expect(page.pagination.hasMore).toBe(true);
      expect(page.items).toHaveLength(1);
      expect(page.context.universeVersion).toBe('2026-08-26');

      const all = await universe.dataGaps({ limit: 200 });
      const gaps = all.items.map((row) => row.ticker);
      // Сначала те, за кем стоят деньги: 12 млрд впереди 3.75 млрд.
      expect(gaps).toEqual(['BIGV', 'XMR']);
      // Подтверждённый ноль — измерение, а не задача.
      expect(gaps).not.toContain('ZERO');
      expect(gaps).not.toContain('AAVE');

      const xmr = all.items.find((row) => row.ticker === 'XMR');
      expect(xmr?.gaps.map((gap) => gap.field).sort()).toEqual([
        'comparisonGroup',
        'revenue',
        'tokenomics',
      ]);
      expect(xmr?.gaps.every((gap) => gap.fix.length > 0)).toBe(true);
    });

    it('фильтры сужают очередь, не подменяя её состав', async () => {
      const byState = await universe.dataGaps({ dataState: 'unsupported_business_model' });
      expect(byState.items.map((row) => row.ticker)).toEqual(['XMR']);

      const byGroup = await universe.dataGaps({ comparisonGroup: 'lending' });
      // Непустой список обязателен: every на пустом массиве истинен и не доказывает ничего.
      expect(byGroup.items.map((row) => row.ticker)).toEqual(['BIGV']);
    });
  });

  describe('Конверт и ошибки', () => {
    it('список приходит с происхождением и страницей, а не голым массивом', async () => {
      const page = await universe.list({ limit: 2 });

      expect(page.context.universeVersion).toBe('2026-08-26');
      expect(page.context.activeFilters.screen.enabled).toBe(false);
      expect(page.pagination).toMatchObject({ offset: 0, limit: 2, hasMore: true });
      expect(page.items).toHaveLength(2);
    });

    it('по умолчанию строка компактна: перцентили и peers едут только по view=full', async () => {
      await universe.applyAlphaFilter({ enabled: true, profileId: 'default' });

      const summary = await universe.list({ limit: 5 });
      const full = await universe.list({ limit: 5, view: 'full' });

      // Через JSON намеренно: значение имеет форма, уходящая в браузер, а не
      // объект в памяти. Заодно видно undefined-ключи, если их кто-то допишет.
      const wire = JSON.parse(JSON.stringify(summary.items[0])) as Record<string, unknown>;
      expect(Object.keys(wire)).not.toContain('alpha');
      expect(Object.keys(wire)).not.toContain('defillamaSlugs');
      expect(Object.keys(wire)).not.toContain('rawSectors');
      expect(wire).toHaveProperty('rankInSector');

      expect(full.items[0]).toHaveProperty('alpha');
      // Вес ответа считает не браузер, а тест: 300 КБ — это порог, а не пожелание.
      expect(JSON.stringify(summary.items).length).toBeLessThan(
        JSON.stringify(full.items).length,
      );
    });

    it('НЕГАТИВНЫЙ: несобранная вселенная — ошибка с кодом и переходом, а не тупик', async () => {
      (store.loadSnapshot as jest.Mock).mockResolvedValue(null);

      await expect(universe.list()).rejects.toBeInstanceOf(NotFoundException);
      await universe.list().catch((error: NotFoundException) => {
        expect(error.getResponse()).toMatchObject({
          code: 'universe_missing',
          nextAction: { method: 'POST', path: '/universe/refresh' },
        });
      });
    });

    it('НЕГАТИВНЫЙ: занятый слот отказывает с job_busy и переходом на GET /status', () => {
      jobs.tryAcquire('universe/refresh');

      try {
        jobs.acquireOrFail('universe/prices');
        throw new Error('Ожидалась 409');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({
          code: 'job_busy',
          nextAction: { path: '/status' },
        });
      }
    });
  });
});