import { StoreService } from '../src/core/store/store.service';
import { EmissionsService } from '../src/core/tokenomics/emissions.service';
import { TokenomicsService } from '../src/core/tokenomics/tokenomics.service';
import { ManualService } from '../src/core/manual/manual.service';
import { UniverseService } from '../src/core/universe/universe.service';
import { EMPTY_TOKENOMICS } from '../src/core/tokenomics/tokenomics.constants';
import type { UniverseSnapshot } from '../src/core/universe/universe.types';

const DAY = 86_400;
const NOW_SEC = Math.floor(Date.now() / 1_000);

function snapshot(): UniverseSnapshot {
  const base = {
    ...EMPTY_TOKENOMICS,
    rank: 1,
    circulating: 1_000,
    totalSupply: 2_000,
    priceUsd: 1,
    vol24hUsd: 1_000,
    floatPct: 50,
    holderYieldPct: 1,
    mcapCalcUsd: 1_000,
    defillamaSlugs: [] as string[],
  };
  return {
    version: '2026-08-26',
    builtAt: '2026-08-26T06:00:00.000Z',
    topN: 3,
    sources: {},
    excludedIds: [],
    warnings: [],
    candidates: [
      { ...base, coingeckoId: 'ok', ticker: 'OK' },
      { ...base, coingeckoId: 'broken', ticker: 'BROKEN' },
      { ...base, coingeckoId: 'twins', ticker: 'TWIN' },
    ],
  } as unknown as UniverseSnapshot;
}

describe('POST /universe/tokenomics', () => {
  let saved: unknown[];
  let store: StoreService;
  let universe: UniverseService;
  let service: TokenomicsService;

  const document = (slug: string) => ({
    slug,
    ok: slug !== 'broken',
    status: slug === 'broken' ? 503 : 200,
    error: slug === 'broken' ? 'HTTP 503' : null,
    pageUrl: `https://defillama.com/unlocks/${slug}`,
    asOf: 'Wed, 26 Aug 2026 04:12:07 GMT',
    data: {
      metadata: {
        unlockEvents: [
          {
            timestamp: NOW_SEC + 30 * DAY,
            cliffAllocations: [{ recipient: 'Team', category: 'team', amount: 100 }],
            summary: { totalTokensCliff: 100 },
          },
        ],
      },
      supplyMetrics: { maxSupply: 2_000, tbdAmount: 0 },
    },
  });

  beforeEach(() => {
    saved = [];
    store = {
      loadSnapshot: jest.fn().mockResolvedValue(null),
      saveSnapshot: jest.fn(async (_name: string, value: unknown) => {
        saved.push(value);
        return '/tmp/facts.json';
      }),
      saveRaw: jest.fn().mockResolvedValue('/tmp/raw.json'),
    } as unknown as StoreService;

    const current = snapshot();
    universe = {
      latest: jest.fn().mockResolvedValue(current),
      ageDays: jest.fn().mockResolvedValue(1),
      saveNumbers: jest.fn(async (update: { candidates: unknown[] }) => {
        saved.push(update.candidates);
      }),
      runExternalJob: jest.fn(
        async (
          _name: string,
          _step: string,
          _label: string,
          run: (report: () => void) => Promise<string>,
        ) => {
          await run(() => undefined);
          return { started: true, reason: 'forced', ageDays: 1, message: 'ok' };
        },
      ),
    } as unknown as UniverseService;

    const emissions = {
      index: jest.fn().mockResolvedValue({
        universeVersion: '2026-08-26',
        builtAt: '2026-08-26T06:00:00.000Z',
        documents: 3,
        slugs: ['ok', 'broken', 'twin-a', 'twin-b'],
        byGecko: { ok: ['ok'], broken: ['broken'], twins: ['twin-a', 'twin-b'] },
        failed: [],
      }),
      document: jest.fn(async (slug: string) => document(slug)),
    } as unknown as EmissionsService;

    const manual = {
      unlocksByCoingeckoId: jest.fn().mockResolvedValue(new Map()),
    } as unknown as ManualService;

    service = new TokenomicsService(store, emissions, universe, manual);
  });

  it('сбой одного документа не роняет прогон и не превращается в ноль', async () => {
    await service.refresh({});
    const candidates = saved.at(-1) as { coingeckoId: string; tokenomicsState: string; unlock12mPct: number | null }[];
    const broken = candidates.find((item) => item.coingeckoId === 'broken');

    expect(broken?.tokenomicsState).toBe('source_error');
    expect(broken?.unlock12mPct).toBeNull();
    // Строка осталась в выборке: пробел в данных — не отсев.
    expect(candidates).toHaveLength(3);
  });

  it('два слага на один токен — отказ, а не выбор большего', async () => {
    await service.refresh({});
    const candidates = saved.at(-1) as { coingeckoId: string; tokenomicsState: string }[];

    expect(candidates.find((item) => item.coingeckoId === 'twins')?.tokenomicsState).toBe(
      'mapping_failed',
    );
  });

  it('считает разводнение и сохраняет ссылку с датой источника', async () => {
    await service.refresh({});
    const candidates = saved.at(-1) as Record<string, unknown>[];
    const ok = candidates.find((item) => item.coingeckoId === 'ok');

    expect(ok?.unlock12mPct).toBe(10);
    expect(ok?.netHolderYieldPct).toBe(-9);
    expect(ok?.tokenomicsSource).toBe('https://defillama.com/unlocks/ok');
    expect(Date.parse(String(ok?.asOfTokenomics))).not.toBeNaN();
  });

  it('состав и дата сборки вселенной не меняются', async () => {
    await service.refresh({});
    const facts = saved.find((item) => !Array.isArray(item)) as { universeVersion: string };

    expect(facts.universeVersion).toBe('2026-08-26');
    expect(universe.saveNumbers).toHaveBeenCalledTimes(1);
  });
});