import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AgentRunnerService } from '../src/agents/agent-runner.service';
import { DEEP_VALUE_PROFILE, DEFAULT_PROFILE } from '../src/config/profiles';
import { StoreService } from '../src/core/store/store.service';import { Agent, AgentContext, AgentResult, SnapshotRow } from '../src/core/types';
import type { AnalysisProfile } from '../src/core/universe/profile.types';

function memoryStore(): { store: StoreService; keys: () => string[] } {
  const cache = new Map<string, unknown>();
  const store = {
    cacheGet: jest.fn(async (ns: string, key: string) => cache.get(`${ns}/${key}`) ?? null),
    cachePut: jest.fn(async (ns: string, key: string, value: unknown) => {
      cache.set(`${ns}/${key}`, value);
      return value;
    }),
  } as unknown as StoreService;
  return { store, keys: () => [...cache.keys()] };
}

class StubAgent implements Agent {
  calls = 0;
  readonly title = 'Заглушка';
  readonly needs: (keyof SnapshotRow)[] = [];

  constructor(
    readonly name: string,
    readonly needsLlm = false,
    private readonly patch: Partial<AgentResult> = {},
  ) {}

  async run(token: string): Promise<AgentResult> {
    this.calls += 1;
    return {
      agent: this.name,
      title: this.title,
      token,
      sector: null,
      asOf: new Date().toISOString(),
      verdict: {},
      score: 50,
      metrics: {},
      dataQuality: 1,
      missing: [],
      notes: '',
      ...this.patch,
    };
  }
}

const row = { ticker: 'AAVE' } as SnapshotRow;
// Тип параметра задан явно: без аннотации TS выводит его из DEFAULT_PROFILE
// и сужает weights до четырёх известных ключей, куда другой профиль не подходит.
const ctx = (profile: AnalysisProfile = DEFAULT_PROFILE): AgentContext => ({
  snapshot: [],
  profile,
});

describe('AgentRunnerService', () => {
  it('пустой реестр — законное состояние, а не сбой', () => {
    const service = new AgentRunnerService(memoryStore().store);

    expect(service.list()).toEqual([]);
    expect(() => service.byName('screener')).toThrow(NotFoundException);
    expect(() => service.byName('screener')).toThrow(/не зарегистрирован/);
  });

  it('кэширует результат кодового агента и различает профили', async () => {
    const { store } = memoryStore();
    const agent = new StubAgent('screener');
    const service = new AgentRunnerService(store, [agent]);

    await service.run('screener', 'AAVE', row, ctx());
    await service.run('screener', 'AAVE', row, ctx());
    expect(agent.calls).toBe(1);

    // Другие пороги — другой балл: чужой результат отдавать нельзя.
    await service.run('screener', 'AAVE', row, ctx(DEEP_VALUE_PROFILE));
    expect(agent.calls).toBe(2);

    await service.run('screener', 'AAVE', row, ctx(), { refresh: true });
    expect(agent.calls).toBe(3);
  });

  it('профиль не входит в ключ LLM-агента', async () => {
    const { store } = memoryStore();
    const agent = new StubAgent('mechanism', true);
    const service = new AgentRunnerService(store, [agent]);

    await service.run('mechanism', 'AAVE', row, ctx());
    await service.run('mechanism', 'AAVE', row, ctx(DEEP_VALUE_PROFILE));

    expect(agent.calls).toBe(1);
  });

  it('НЕГАТИВНЫЙ: результат со сбоем источника не кэшируется', async () => {
    const { store, keys } = memoryStore();
    const agent = new StubAgent('screener', false, { error: 'DeFiLlama 503', score: null });
    const service = new AgentRunnerService(store, [agent]);

    await service.run('screener', 'AAVE', row, ctx());
    await service.run('screener', 'AAVE', row, ctx());

    expect(agent.calls).toBe(2);
    expect(keys()).toEqual([]);
  });

  it('НЕГАТИВНЫЙ: неизвестный profileId отвергается с перечнем доступных', () => {
    const service = new AgentRunnerService(memoryStore().store);

    expect(service.resolveProfile()).toBe(DEFAULT_PROFILE);
    expect(service.resolveProfile('deep-value')).toBe(DEEP_VALUE_PROFILE);
    expect(() => service.resolveProfile('нет-такого')).toThrow(BadRequestException);
  });
});