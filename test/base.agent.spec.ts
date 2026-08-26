import { BaseAgent } from '../src/agents/base.agent';
import { StoreService } from '../src/core/store/store.service';
import { AgentResult, SnapshotRow } from '../src/core/types';
import { metric, ValidateService } from '../src/core/validate/validate.service';

function row(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    ticker: 'AAVE',
    name: 'Aave',
    sector: 'lending',
    asOf: '2026-08-26T09:00:00.000Z',
    priceUsd: 250,
    mcapUsd: 3_750_000_000,
    fdvUsd: 4_000_000_000,
    vol24hUsd: 200_000_000,
    circulating: 15_000_000,
    totalSupply: 16_000_000,
    revenue1y: 92_000_000,
    revenue30d: 7_500_000,
    tvlUsd: 20_000_000_000,
    mcapSource: 'https://api.coingecko.com/api/v3/coins/markets',
    feesSource: 'https://defillama.com/protocol/aave-v3',
    tvlSource: 'https://defillama.com/protocol/aave-v3',
    errors: [],
    ...overrides,
  };
}

class TestAgent extends BaseAgent {
  readonly name = 'test';
  readonly title = 'Тестовый агент';
  readonly needs: (keyof SnapshotRow)[] = [];
  private readonly outcome: () => Promise<Partial<AgentResult>>;

  constructor(
    validate: ValidateService,
    store: StoreService,
    outcome: () => Promise<Partial<AgentResult>>,
    needs: (keyof SnapshotRow)[] = [],
  ) {
    super(validate, store);
    this.outcome = outcome;
    this.needs = needs;
  }

  protected analyze(): Promise<Partial<AgentResult>> {
    return this.outcome();
  }
}

describe('BaseAgent', () => {
  const saved: AgentResult[] = [];
  const store = {
    saveResult: jest.fn(async (_agent: string, _token: string, result: unknown) => {
      saved.push(result as AgentResult);
      return '/tmp/result.json';
    }),
  } as unknown as StoreService;
  const validate = new ValidateService();

  beforeEach(() => {
    jest.clearAllMocks();
    saved.length = 0;
  });

  it('НЕГАТИВНЫЙ: метрика без источника обнуляется и режет балл множителем качества', async () => {
    const now = new Date().toISOString();
    const agent = new TestAgent(validate, store, async () => ({
      score: 80,
      metrics: {
        mcapUsd: metric(3_750_000_000, 'https://api.coingecko.com/api/v3/coins/markets', now, 'USD'),
        revenue12mUsd: metric(92_000_000, null, now, 'USD'),
      },
    }));

    const result = await agent.run('aave', row(), { snapshot: [] });

    expect(result.metrics.revenue12mUsd).toMatchObject({ value: null, droppedReason: 'no_source' });
    expect(result.missing).toContain('revenue12mUsd');
    expect(result.dataQuality).toBe(0.5);
    expect(result.scoreRaw).toBe(80);
    expect(result.score).toBe(60);
    // Тикер берётся из данных, а не из пути запроса.
    expect(result.token).toBe('AAVE');
    expect(saved).toHaveLength(1);
  });

  it('НЕГАТИВНЫЙ: отсутствующий вход не теряется, когда агент вернул собственный missing', async () => {
    const agent = new TestAgent(
      validate,
      store,
      async () => ({ missing: ['календарь разлоков'], notes: 'Разводнение неизвестно.' }),
      ['mcapUsd'],
    );

    const result = await agent.run('AAVE', row({ mcapUsd: null }), { snapshot: [] });

    expect(result.missing).toEqual(expect.arrayContaining(['mcapUsd', 'календарь разлоков']));
    expect(result.notes).toContain('Нет входных данных: mcapUsd');
    expect(result.notes).toContain('Разводнение неизвестно.');
    expect(result.score).toBeNull();
  });

  it('НЕГАТИВНЫЙ: исключение в логике агента не роняет запрос', async () => {
    const agent = new TestAgent(validate, store, async () => {
      throw new Error('DeFiLlama 503');
    });

    const result = await agent.run('AAVE', row(), { snapshot: [] });

    expect(result.error).toBe('DeFiLlama 503');
    expect(result.score).toBeNull();
    expect(result.notes).toContain('ОШИБКА агента');
    expect(saved).toHaveLength(1);
  });
});