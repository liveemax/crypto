import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { BUILTIN_PROFILES, DEFAULT_PROFILE, getProfile } from '../config/profiles';
import { StoreService } from '../core/store/store.service';
import { Agent, AgentContext, AgentResult, SnapshotRow } from '../core/types';
import type { AnalysisProfile } from '../core/universe/profile.types';
import { fileKey, profileHash } from './agent-keys';
import { AGENT } from './agents.constants';

export interface AgentInfo {
  name: string;
  title: string;
  needsLlm: boolean;
  needs: string[];
}

export interface AgentRunOptions {
  /** true — пересчитать, не заглядывая в дневной кэш. */
  refresh?: boolean;
}

/** Сутки: снапшот за день не меняется, а прогон модели стоит денег при каждом вызове. */
const CACHE_TTL_DAYS = 1;

@Injectable()
export class AgentRunnerService {
  constructor(
    private readonly store: StoreService,
    // Опционально: пустой реестр — законное состояние до шага 08, а не сбой сборки.
    @Optional() @Inject(AGENT) private readonly agents: Agent[] = [],
  ) {}

  /** Все зарегистрированные агенты; пустой массив — не ошибка. */
  list(): AgentInfo[] {
    return [...(this.agents ?? [])]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((agent) => ({
        name: agent.name,
        title: agent.title,
        needsLlm: agent.needsLlm,
        needs: agent.needs.map(String),
      }));
  }

  /** Находит агента по имени; незарегистрированное имя — 404 с перечнем доступных. */
  byName(name: string): Agent {
    const found = (this.agents ?? []).find((agent) => agent.name === name);
    if (found) return found;

    const available = (this.agents ?? [])
      .map((agent) => agent.name)
      .sort()
      .join(', ');
    throw new NotFoundException(
      available.length > 0
        ? `Агент ${name} не зарегистрирован. Доступны: ${available}`
        : `Агент ${name} не зарегистрирован. Ни один агент пока не подключён, см. GET /agents`,
    );
  }

  /** Профиль для контекста: пороги хард-фильтров агент берёт отсюда, а не из констант. */
  resolveProfile(profileId?: string): AnalysisProfile {
    const id = profileId?.trim();
    if (!id) return DEFAULT_PROFILE;

    const profile = getProfile(id);
    if (!profile) {
      const known = BUILTIN_PROFILES.map((item) => item.id).join(', ');
      throw new BadRequestException(`Неизвестный profileId: ${id}. Доступные профили: ${known}`);
    }
    return profile;
  }

  /** Запускает агента с дневным кэшем результата. */
  async run(
    name: string,
    token: string,
    row: SnapshotRow,
    ctx: AgentContext,
    options: AgentRunOptions = {},
  ): Promise<AgentResult> {
    const agent = this.byName(name);
    const namespace = `agent-${agent.name}`;
    const key = this.cacheKey(agent, row?.ticker ?? token, ctx);

    if (options.refresh !== true) {
      const cached = await this.store.cacheGet<AgentResult>(namespace, key, CACHE_TTL_DAYS);
      if (cached) return cached;
    }

    const result = await agent.run(token, row, ctx);

    // Сбой источника в кэше живёт сутки и притворяется фактом: не кэшируем.
    if (result.error === undefined) await this.store.cachePut(namespace, key, result);
    return result;
  }

  /**
   * Балл кодового агента зависит от порогов, поэтому профиль входит в ключ.
   * LLM-агент от профиля не зависит — иначе пятый профиль стоил бы пятого прогона модели.
   */
  private cacheKey(agent: Agent, ticker: string, ctx: AgentContext): string {
    const token = fileKey(ticker);
    return agent.needsLlm ? token : `${token}.${profileHash(ctx.profile ?? DEFAULT_PROFILE)}`;
  }
}