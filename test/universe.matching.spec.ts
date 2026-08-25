import { CoingeckoService, CoinMarket } from '../src/core/fetch/coingecko.service';
import { DefillamaService, LlamaProtocol } from '../src/core/fetch/defillama.service';
import { UniverseBuilder } from '../src/core/universe/universe.builder';

function market(overrides: Partial<CoinMarket> = {}): CoinMarket {
  return {
    coingeckoId: 'aave',
    ticker: 'AAVE',
    name: 'Aave',
    priceUsd: 100,
    mcapUsd: 1_000_000_000,
    fdvUsd: 1_100_000_000,
    vol24hUsd: 50_000_000,
    circulating: 10_000_000,
    totalSupply: 11_000_000,
    sourceUrl: 'https://api.coingecko.com/api/v3/coins/markets',
    asOf: '2026-08-25T10:00:00.000Z',
    ...overrides,
  };
}

function protocol(overrides: Partial<LlamaProtocol> = {}): LlamaProtocol {
  return {
    id: '1',
    slug: 'aave-v2',
    name: 'Aave V2',
    geckoId: 'aave',
    symbol: 'AAVE',
    category: 'Lending',
    tvlUsd: 111_000_000,
    parentProtocol: 'parent#aave',
    ...overrides,
  };
}

const MARKETS: CoinMarket[] = [
  market(),
  market({ coingeckoId: 'uniswap', ticker: 'UNI', name: 'Uniswap' }),
  market({ coingeckoId: 'tron', ticker: 'TRX', name: 'TRON' }),
];

const PROTOCOLS: LlamaProtocol[] = [
  // gecko_id знает только мёртвая v2; живая v3 держит в 150 раз больше.
  protocol(),
  protocol({ id: '2', slug: 'aave-v3', name: 'Aave V3', geckoId: null, tvlUsd: 17_000_000_000 }),
  // Uniswap не знает gecko_id ни в одной версии — только тикер.
  protocol({
    id: '3',
    slug: 'uniswap-v3',
    name: 'Uniswap V3',
    geckoId: null,
    symbol: 'UNI',
    category: 'Dexs',
    tvlUsd: 1_500_000_000,
    parentProtocol: 'parent#uniswap',
  }),
  protocol({
    id: '4',
    slug: 'uniswap-v2',
    name: 'Uniswap V2',
    geckoId: null,
    symbol: 'UNI',
    category: 'Dexs',
    tvlUsd: 1_000_000_000,
    parentProtocol: 'parent#uniswap',
  }),
  // Слаг совпадает с именем сети: источник дубля в defillamaSlugs.
  protocol({
    id: '5',
    slug: 'tron',
    name: 'Tron',
    geckoId: 'tron',
    symbol: 'TRX',
    category: 'Chain',
    tvlUsd: 5_000_000_000,
    parentProtocol: null,
  }),
];

function services(options: { categoryEmpty?: string; markets?: CoinMarket[] } = {}) {
  const coingecko = {
    getTopMarkets: jest.fn().mockResolvedValue({
      rows: options.markets ?? MARKETS,
      errors: [],
    }),
    getCategoryIds: jest.fn().mockImplementation(async (category: string) => ({
      ids: category === options.categoryEmpty ? [] : ['excluded-coin'],
      status: 200,
      error: null,
    })),
  } as unknown as CoingeckoService;

  const defillama = {
    getProtocols: jest.fn().mockResolvedValue(PROTOCOLS),
    getChains: jest.fn().mockResolvedValue([
      { name: 'Tron', geckoId: 'tron', tvlUsd: 5_000_000_000, tokenSymbol: 'TRX' },
    ]),
    getStablecoinGeckoIds: jest.fn().mockResolvedValue(['tether']),
    getFeesOverview: jest.fn().mockImplementation(async () => [
      {
        protocolId: '2',
        slug: 'aave-v3',
        name: 'Aave V3',
        category: 'Lending',
        protocolType: 'protocol',
        latestFetchIsOk: true,
        total30d: 1_000_000,
        total1y: 12_000_000,
      },
      // Одна и та же страница дважды: строкой протокола и строкой сети.
      {
        protocolId: '5',
        slug: 'tron',
        name: 'Tron',
        category: 'Chain',
        protocolType: 'protocol',
        latestFetchIsOk: true,
        total30d: 1_000_000,
        total1y: 10_000_000,
      },
      {
        protocolId: '99',
        slug: 'tron',
        name: 'Tron',
        category: 'Chain',
        protocolType: 'chain',
        latestFetchIsOk: true,
        total30d: 1_000_000,
        total1y: 10_000_000,
      },
    ]),
  } as unknown as DefillamaService;

  return { coingecko, defillama };
}

describe('Склейка с DeFiLlama', () => {
  it('переносит gecko_id мёртвой версии на живые через родителя', async () => {
    const { coingecko, defillama } = services();
    const output = await new UniverseBuilder(coingecko, defillama).build(3);
    const aave = output.candidates.find((item) => item.ticker === 'AAVE');

    expect(aave?.matchedBy).toBe('gecko_id');
    expect(aave?.defillamaSlugs).toContain('aave-v3');
    // TVL всей группы, а не одной v2 на 111 млн.
    expect(aave?.tvlUsd).toBeGreaterThan(1_000_000_000);
  });

  it('находит по тикеру группу, где gecko_id пуст везде', async () => {
    const { coingecko, defillama } = services();
    const output = await new UniverseBuilder(coingecko, defillama).build(3);
    const uni = output.candidates.find((item) => item.ticker === 'UNI');

    expect(uni?.matchedBy).toBe('symbol');
    expect(uni?.defillamaSlugs.sort()).toEqual(['uniswap-v2', 'uniswap-v3']);
  });

  it('отказывается склеивать тикер, на который претендуют две разные группы', async () => {
    const { coingecko, defillama } = services();
    (defillama.getProtocols as jest.Mock).mockResolvedValue([
      ...PROTOCOLS,
      protocol({
        id: '6',
        slug: 'not-uniswap',
        name: 'Impostor',
        geckoId: null,
        symbol: 'UNI',
        category: 'Dexs',
        tvlUsd: 2_000_000_000,
        parentProtocol: 'parent#impostor',
      }),
    ]);

    const output = await new UniverseBuilder(coingecko, defillama).build(3);
    const uni = output.candidates.find((item) => item.ticker === 'UNI');

    expect(uni?.matchedBy).toBe('none');
    expect(output.warnings.some((line) => line.includes('неоднозначн'))).toBe(true);
  });

  it('не кладёт один слаг в кандидата дважды', async () => {
    const { coingecko, defillama } = services();
    const output = await new UniverseBuilder(coingecko, defillama).build(3);

    for (const item of output.candidates) {
      expect(new Set(item.defillamaSlugs).size).toBe(item.defillamaSlugs.length);
    }
  });

  it('не складывает выручку одной страницы дважды', async () => {
    const { coingecko, defillama } = services();
    const output = await new UniverseBuilder(coingecko, defillama).build(3);
    const trx = output.candidates.find((item) => item.ticker === 'TRX');

    // Две строки по 10 млн — один протокол, а не двадцать миллионов.
    expect(trx?.fees12mUsd).toBe(10_000_000);
  });

  it('отчитывается о способах склейки', async () => {
    const { coingecko, defillama } = services();
    const output = await new UniverseBuilder(coingecko, defillama).build(3);

    expect(output.warnings.some((line) => line.startsWith('Склейка DeFiLlama:'))).toBe(true);
  });
});

describe('Сборка отказывается собирать неполное', () => {
  it('падает, если категория исключений не дала состав', async () => {
    const { coingecko, defillama } = services({ categoryEmpty: 'meme-token' });
    await expect(new UniverseBuilder(coingecko, defillama).build(3)).rejects.toThrow(
      /категор/i,
    );
  });

  it('падает, если рынок вернул меньше монет, чем запрошено', async () => {
    const { coingecko, defillama } = services({ markets: [market()] });
    await expect(new UniverseBuilder(coingecko, defillama).build(3)).rejects.toThrow(
      /загружено/i,
    );
  });
});