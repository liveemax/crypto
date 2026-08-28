import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StoreService } from '../store/store.service';
import { UniverseService } from '../universe/universe.service';
import type { ManualUnlockInput, ManualUnlockRecord } from './manual.types';

const UNLOCKS_STATE = 'manual-unlocks';
const CATEGORIES = ['team', 'investors', 'community', 'ecosystem', 'other', 'unknown'];

@Injectable()
export class ManualService {
  constructor(
    private readonly store: StoreService,
    private readonly universe: UniverseService,
  ) {}

  /** Добавляет разлок; ссылка и дата источника обязательны, иначе числа не будет. */
  async addUnlock(input: ManualUnlockInput): Promise<ManualUnlockRecord> {
    const identity = await this.resolve(input.ticker);
    const record: ManualUnlockRecord = {
      ...input,
      ...identity,
      ticker: identity.ticker,
      date: isoOrFail(input.date, 'date'),
      asOf: isoOrFail(input.asOf, 'asOf'),
      sourceUrl: urlOrFail(input.sourceUrl),
      tokens: positiveOrFail(input.tokens),
      category: CATEGORIES.includes(input.category) ? input.category : 'unknown',
      id: `unlock_${randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
    const all = await this.all();
    await this.store.saveState(UNLOCKS_STATE, [...all, record]);
    return record;
  }

  /** Ручные записи по тикеру или идентификатору; пусто — законное состояние. */
  async unlocks(token: string): Promise<ManualUnlockRecord[]> {
    const identity = await this.resolve(token);
    const all = await this.all();
    return all.filter((item) => item.coingeckoId === identity.coingeckoId);
  }

  /** Удаляет запись по её идентификатору. */
  async removeUnlock(id: string): Promise<void> {
    const all = await this.all();
    const rest = all.filter((item) => item.id !== id);
    if (rest.length === all.length) {
      throw new NotFoundException(`Ручной записи ${id} нет. Список — GET /manual/unlocks/{token}`);
    }
    await this.store.saveState(UNLOCKS_STATE, rest);
  }

  /** Ручной календарь, сгруппированный для склейки с провайдером. */
  async unlocksByCoingeckoId(): Promise<Map<string, ManualUnlockRecord[]>> {
    const grouped = new Map<string, ManualUnlockRecord[]>();
    for (const record of await this.all()) {
      grouped.set(record.coingeckoId, [...(grouped.get(record.coingeckoId) ?? []), record]);
    }
    return grouped;
  }

  private async all(): Promise<ManualUnlockRecord[]> {
    return (await this.store.loadState<ManualUnlockRecord[]>(UNLOCKS_STATE)) ?? [];
  }

  /** Тикер не идентификатор: символ, встреченный дважды, — отказ, а не выбор большего. */
  private async resolve(token: string): Promise<{ coingeckoId: string; ticker: string }> {
    const snapshot = await this.universe.latest();
    if (!snapshot) {
      throw new NotFoundException('Вселенная ещё не собрана. Вызовите POST /universe/refresh');
    }
    const wanted = token.trim().toLowerCase();
    const byId = snapshot.candidates.find((item) => item.coingeckoId.toLowerCase() === wanted);
    if (byId) return { coingeckoId: byId.coingeckoId, ticker: byId.ticker };

    const byTicker = snapshot.candidates.filter((item) => item.ticker.toLowerCase() === wanted);
    if (byTicker.length > 1) {
      throw new ConflictException(
        `Тикер ${token} принадлежит нескольким монетам: ` +
          `${byTicker.map((item) => item.coingeckoId).join(', ')}. Передайте coingeckoId`,
      );
    }
    const one = byTicker[0];
    if (!one) {
      throw new NotFoundException(`${token} нет во вселенной ${snapshot.version}. Проверьте GET /universe`);
    }
    return { coingeckoId: one.coingeckoId, ticker: one.ticker };
  }
}

function urlOrFail(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
    return url.toString();
  } catch {
    throw new BadRequestException(
      'sourceUrl обязателен и должен быть открываемой ссылкой: число без источника обнуляется',
    );
  }
}

function isoOrFail(value: string, field: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new BadRequestException(`${field} должен быть датой в формате ISO 8601`);
  }
  return new Date(parsed).toISOString();
}

function positiveOrFail(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new BadRequestException('tokens должен быть положительным числом токенов, не строкой');
  }
  return value;
}