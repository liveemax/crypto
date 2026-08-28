import { add, div, mul, pctOf, round, sub } from '../money';
import { isRecord, nullableNumber } from '../fetch/fetch.utils';
import { CLIFF_MISMATCH_PCT, WEEK_SECONDS } from './tokenomics.constants';
import type { UnlockCategory } from './tokenomics.types';

/** Имя получателя с этой пометкой — прогноз наград, то есть эмиссия, а не вестинг. */
const FORECAST = /\(forecast\)/i;

export interface CliffEvent {
  at: number;
  tokens: number;
  recipient: string;
  category: UnlockCategory;
}

export interface RateSegment {
  recipient: string;
  category: UnlockCategory;
  at: number;
  end: number;
  ratePerWeek: number;
}

export interface ParsedCalendar {
  cliffs: CliffEvent[];
  rates: RateSegment[];
  /** Хотя бы одна сумма или дата не разобрана: число из документа не берётся. */
  unparsed: boolean;
  /** Сумма клиффов разошлась с summary.totalTokensCliff больше чем на 0.5%. */
  mismatch: boolean;
  includesForecast: boolean;
}

/**
 * Календарь лежит в metadata.unlockEvents. documentedData.data — суточный
 * кумулятивный график: сложив его точки, мы посчитали бы одни и те же токены
 * столько раз, сколько дней они уже разлочены.
 */
export function calendarNodes(document: unknown): unknown[] | null {
  const metadata = isRecord(document) ? document.metadata : null;
  if (!isRecord(metadata)) return null;
  if (Array.isArray(metadata.unlockEvents)) return metadata.unlockEvents;
  if (Array.isArray(metadata.events)) return metadata.events;
  return null;
}

/** Категория получателя — свободный текст источника; в расчёт чисел она не входит. */
export function categoryOf(raw: unknown): UnlockCategory {
  if (typeof raw !== 'string') return 'unknown';
  const value = raw.trim().toLowerCase();
  if (value === '' || value === 'uncategorized') return 'unknown';
  if (/(team|founder|insider|employee|advisor)/.test(value)) return 'team';
  if (/(investor|private|seed|strategic|presale|pre-sale|vc)/.test(value)) return 'investors';
  if (/(community|airdrop|public|user)/.test(value)) return 'community';
  if (/(ecosystem|treasury|foundation|dao|reward|farming|incentive|liquidity)/.test(value)) {
    return 'ecosystem';
  }
  return 'other';
}

/** Разбирает события документа: клиффы отдельно от ставок линейных аллокаций. */
export function parseCalendar(nodes: readonly unknown[]): ParsedCalendar {
  const cliffs: CliffEvent[] = [];
  const rates: RateSegment[] = [];
  let unparsed = false;
  let mismatch = false;
  let includesForecast = false;

  for (const node of nodes) {
    if (!isRecord(node)) {
      unparsed = true;
      continue;
    }
    const at = typeof node.timestamp === 'number' ? node.timestamp : null;
    if (at === null || !Number.isFinite(at)) {
      unparsed = true;
      continue;
    }

    let declaredSum: number | null = null;
    if (Array.isArray(node.cliffAllocations)) {
      for (const allocation of node.cliffAllocations) {
        if (!isRecord(allocation)) {
          unparsed = true;
          continue;
        }
        const amount = nullableNumber(allocation.amount);
        if (amount === null) {
          unparsed = true;
          continue;
        }
        const recipient =
          typeof allocation.recipient === 'string' ? allocation.recipient : 'unknown';
        if (FORECAST.test(recipient)) includesForecast = true;
        declaredSum = add(declaredSum ?? 0, amount);
        if (amount > 0) {
          cliffs.push({ at, tokens: amount, recipient, category: categoryOf(allocation.category) });
        }
      }
    }

    // Итог источника — проверка нашей суммы, а не второй источник числа.
    const declared = isRecord(node.summary) ? nullableNumber(node.summary.totalTokensCliff) : null;
    if (
      declaredSum !== null &&
      declared !== null &&
      declared > 0 &&
      Math.abs(pctOf(sub(declaredSum, declared), declared)) > CLIFF_MISMATCH_PCT
    ) {
      mismatch = true;
    }

    if (Array.isArray(node.linearAllocations)) {
      for (const allocation of node.linearAllocations) {
        if (!isRecord(allocation)) {
          unparsed = true;
          continue;
        }
        const ratePerWeek = nullableNumber(allocation.newRatePerWeek);
        const end = typeof allocation.endTimestamp === 'number' ? allocation.endTimestamp : null;
        if (ratePerWeek === null || end === null || !Number.isFinite(end)) {
          unparsed = true;
          continue;
        }
        const recipient =
          typeof allocation.recipient === 'string' ? allocation.recipient : 'unknown';
        if (FORECAST.test(recipient)) includesForecast = true;
        // Отрицательная ставка — не «возврат токенов», а непонятый документ.
        if (ratePerWeek < 0) {
          unparsed = true;
          continue;
        }
        // Сегмент со ставкой ноль обрывает предыдущий поток того же получателя.
        // Выброшенный как «пустое событие», он оставляет вестинг течь до
        // endTimestamp и завышает разводнение у всех, кто остановил раздачу.
        rates.push({ recipient, category: categoryOf(allocation.category), at, end, ratePerWeek });
      }
    }
  }

  return { cliffs, rates, unparsed, mismatch, includesForecast };
}

/**
 * Токенов, разлоченных в окне: клиффы внутри него плюс интеграл ставок.
 * Следующая смена ставки у того же получателя обрывает предыдущую — иначе
 * потоки складываются сами с собой и разводнение удваивается правдоподобно.
 */
export function unlockedIn(
  calendar: ParsedCalendar,
  fromSec: number,
  toSec: number,
): number | null {
  if (calendar.unparsed || calendar.mismatch) return null;
  let total = 0;

  for (const event of calendar.cliffs) {
    if (event.at > fromSec && event.at <= toSec) total = add(total, event.tokens);
  }

  const byRecipient = new Map<string, RateSegment[]>();
  for (const rate of calendar.rates) {
    byRecipient.set(rate.recipient, [...(byRecipient.get(rate.recipient) ?? []), rate]);
  }
  for (const list of byRecipient.values()) {
    const sorted = [...list].sort((left, right) => left.at - right.at);
    for (const [index, segment] of sorted.entries()) {
      const next = sorted[index + 1];
      const segmentEnd = Math.min(segment.end, next?.at ?? segment.end);
      const start = Math.max(segment.at, fromSec);
      const finish = Math.min(segmentEnd, toSec);
      if (finish > start) {
        total = add(total, mul(div(segment.ratePerWeek, WEEK_SECONDS), sub(finish, start)));
      }
    }
  }
  return round(total, 2);
}

/** Вся эмиссия, описанная расписанием: знаменателем она не служит. */
export function scheduledTotal(calendar: ParsedCalendar): number | null {
  return unlockedIn(calendar, 0, Number.MAX_SAFE_INTEGER);
}

/**
 * Полнота расписания. Знаменатель — maxSupply, а не adjustedSupply: последний
 * это эмиссия, у которой график есть, и деление на неё завышало ровно на долю
 * пробела (100% клиффов при 35% пробела давали 154%).
 */
export function completenessOf(
  document: unknown,
  scheduled: number | null,
): { schedulePct: number | null; tbdPct: number | null } {
  const metrics = isRecord(document) ? document.supplyMetrics : null;
  const maxSupply = isRecord(metrics) ? nullableNumber(metrics.maxSupply) : null;
  const tbdAmount = isRecord(metrics) ? nullableNumber(metrics.tbdAmount) : null;
  if (maxSupply === null || maxSupply <= 0) return { schedulePct: null, tbdPct: null };

  const schedulePct = scheduled === null ? null : round(pctOf(scheduled, maxSupply), 2);
  if (tbdAmount !== null) {
    return { schedulePct, tbdPct: round(pctOf(tbdAmount, maxSupply), 2) };
  }
  // Поля tbdAmount нет — пробел считается от нашего же покрытия, но не выдумывается.
  const derived = schedulePct === null ? null : Math.max(round(sub(100, schedulePct), 2), 0);
  return { schedulePct, tbdPct: derived };
}

/** Идентификаторы монеты внутри документа: coingecko id главный и единственный. */
export function geckoIdsOf(node: unknown, depth = 6, out = new Set<string>()): Set<string> {
  if (depth < 0) return out;
  if (typeof node === 'string') {
    if (node.startsWith('coingecko:')) out.add(node.slice('coingecko:'.length).toLowerCase());
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 500)) geckoIdsOf(item, depth - 1, out);
    return out;
  }
  if (!isRecord(node)) return out;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && /^(gecko_id|geckoId|coingeckoId)$/i.test(key)) {
      if (value) out.add(value.toLowerCase());
      continue;
    }
    geckoIdsOf(value, depth - 1, out);
  }
  return out;
}