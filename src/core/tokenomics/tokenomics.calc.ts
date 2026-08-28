import { add, div, mul, pctOf, round, sub } from '../money';
import type { UniverseCandidate } from '../universe/universe.types';
import { unlockedIn } from './emissions.parser';
import type { ParsedCalendar } from './emissions.parser';
import { DAY_SECONDS, EMPTY_TOKENOMICS, HORIZON_DAYS } from './tokenomics.constants';
import type {
  TokenomicsDataState,
  TokenomicsFacts,
  TokenomicsFields,
  TokenomicsSnapshot,
} from './tokenomics.types';

export interface TokenomicsApplyResult {
  candidates: UniverseCandidate[];
  warnings: string[];
  byState: Record<TokenomicsDataState, number>;
  /** Покрытие календарём: по числу и по капитализации, как в шаге 08. */
  calendarCountPct: number;
  calendarMcapPct: number;
  overhangCountPct: number;
}

/**
 * Навес: сколько может выйти, но не когда. totalSupply ниже circulating —
 * рассогласование источника, а не отрицательный навес: null, не ноль.
 */
export function overhangPctOf(
  circulating: number | null,
  totalSupply: number | null,
): number | null {
  if (circulating === null || totalSupply === null || circulating <= 0) return null;
  if (totalSupply < circulating) return null;
  return round(pctOf(sub(totalSupply, circulating), circulating), 2);
}

/** Проценты и стоимость разлока пересчитываются из фактов без единого запроса. */
export function applyTokenomics(
  candidates: readonly UniverseCandidate[],
  snapshot: TokenomicsSnapshot | null,
  nowMs: number = Date.now(),
): TokenomicsApplyResult {
  const byId = new Map((snapshot?.facts ?? []).map((item) => [item.coingeckoId, item]));
  const byState = emptyStateCounter();
  const warnings: string[] = [];

  let calendar = 0;
  let overhang = 0;
  let calendarMcap = 0;
  let totalMcap = 0;
  let yieldMissing = 0;
  let unlockMissing = 0;
  let withNextCliff = 0;
  const contradictory: string[] = [];

  const updated = candidates.map((candidate) => {
    const facts = byId.get(candidate.coingeckoId) ?? null;
    const fields = fieldsFor(candidate, facts, nowMs);
    byState[fields.tokenomicsState] += 1;

    if (fields.overhangPct !== null) overhang += 1;
    if (candidate.mcapCalcUsd !== null) totalMcap = add(totalMcap, candidate.mcapCalcUsd);
    if (fields.unlock12mPct !== null) {
      calendar += 1;
      if (candidate.mcapCalcUsd !== null) calendarMcap = add(calendarMcap, candidate.mcapCalcUsd);
      if (candidate.holderYieldPct === null) yieldMissing += 1;
      if (fields.nextUnlockAt !== null) withNextCliff += 1;
      // Числитель от DeFiLlama, знаменатель от CoinGecko. Разводнение выше
      // навеса значит, что источники считают эмиссию по-разному: у CC навес
      // ноль при календаре на +20%.
      if (fields.overhangPct !== null && fields.unlock12mPct > add(fields.overhangPct, 1)) {
        contradictory.push(candidate.ticker);
      }
    } else if (candidate.holderYieldPct !== null) {
      unlockMissing += 1;
    }
    return { ...candidate, ...fields };
  });

  if (contradictory.length > 0) {
    warnings.push(
      `Разводнение выше навеса у ${contradictory.length} строк ` +
        `(${contradictory.slice(0, 8).join(', ')}): CoinGecko и DeFiLlama считают эмиссию ` +
        'по-разному. Оба числа остаются, сверять их между собой нельзя',
    );
  }
  if (calendar > 0) {
    warnings.push(
      `Ближайший клифф известен у ${withNextCliff} из ${calendar} строк с календарём; ` +
        'у остальных вестинг линейный и дискретного события впереди нет',
    );
  }
  if (yieldMissing > 0) {
    warnings.push(
      `NHY не посчитан у ${yieldMissing} строк: разводнение известно, доходность держателя — нет. ` +
        'Результат был бы смещён вниз, поэтому поле null',
    );
  }
  if (unlockMissing > 0) {
    warnings.push(
      `NHY не посчитан у ${unlockMissing} строк: доходность держателя известна, разводнение — нет. ` +
        'Результат был бы смещён вверх, поэтому поле null',
    );
  }

  const total = candidates.length;
  return {
    candidates: updated,
    warnings,
    byState,
    calendarCountPct: total > 0 ? round(pctOf(calendar, total), 2) : 0,
    calendarMcapPct: totalMcap > 0 ? round(pctOf(calendarMcap, totalMcap), 2) : 0,
    overhangCountPct: total > 0 ? round(pctOf(overhang, total), 2) : 0,
  };
}

function fieldsFor(
  candidate: UniverseCandidate,
  facts: TokenomicsFacts | null,
  nowMs: number,
): TokenomicsFields {
  const overhangPct = overhangPctOf(candidate.circulating, candidate.totalSupply);
  if (facts === null) return { ...EMPTY_TOKENOMICS, overhangPct };

  const base: TokenomicsFields = {
    ...EMPTY_TOKENOMICS,
    overhangPct,
    tokenomicsTbdPct: facts.tbdPct,
    tokenomicsState: facts.state,
    tokenomicsSource: facts.sourceUrl,
    asOfTokenomics: facts.asOf,
  };
  // Право дать число есть только у принятого расписания; отказ числом не заменяется.
  if (facts.state !== 'available' && facts.state !== 'known_zero') return base;

  const calendar = calendarOf(facts);
  if (calendar === null) return { ...base, tokenomicsState: 'matched_unparsed' };

  const nowSec = Math.floor(nowMs / 1_000);
  const tokens30 = unlockedIn(calendar, nowSec, nowSec + HORIZON_DAYS.short * DAY_SECONDS);
  const tokens90 = unlockedIn(calendar, nowSec, nowSec + HORIZON_DAYS.medium * DAY_SECONDS);
  const tokens365 = unlockedIn(calendar, nowSec, nowSec + HORIZON_DAYS.long * DAY_SECONDS);
  const circulating = candidate.circulating;

  const next = calendar.cliffs
    .filter((event) => event.at > nowSec)
    .sort((left, right) => left.at - right.at)[0];
  const nextUnlockUsd =
    next !== undefined && candidate.priceUsd !== null
      ? round(mul(next.tokens, candidate.priceUsd), 2)
      : null;

  const unlock12mPct = share(tokens365, circulating);
  return {
    ...base,
    unlockEventsCount:
      calendar.cliffs.filter((event) => event.at > nowSec).length +
      calendar.rates.filter((rate) => rate.ratePerWeek > 0 && rate.end > nowSec).length,
    unlockTokens30d: tokens30,
    unlockTokens90d: tokens90,
    unlockTokens365d: tokens365,
    unlock30dPct: share(tokens30, circulating),
    unlock90dPct: share(tokens90, circulating),
    unlock12mPct,
    // Считается только когда известны обе половины: иначе знак переворачивается.
    netHolderYieldPct:
      candidate.holderYieldPct !== null && unlock12mPct !== null
        ? round(sub(candidate.holderYieldPct, unlock12mPct), 2)
        : null,
    nextUnlockAt: next === undefined ? null : new Date(next.at * 1_000).toISOString(),
    nextUnlockUsd,
    // Разлок на 3 дневных объёма и на 30 — принципиально разные события.
    nextUnlockCostInDailyVolumes:
      nextUnlockUsd !== null && candidate.vol24hUsd !== null && candidate.vol24hUsd > 0
        ? round(div(nextUnlockUsd, candidate.vol24hUsd), 2)
        : null,
  };
}

/** Факты обратно в календарь. Битая дата — отказ по токену, а не событие в 1970. */
function calendarOf(facts: TokenomicsFacts): ParsedCalendar | null {
  const cliffs = [];
  for (const event of facts.events) {
    const at = Date.parse(event.date);
    if (Number.isNaN(at)) return null;
    cliffs.push({
      at: Math.floor(at / 1_000),
      tokens: event.tokens,
      recipient: event.category,
      category: event.category,
    });
  }
  const rates = [];
  for (const stream of facts.streams) {
    const at = Date.parse(stream.startsAt);
    const end = Date.parse(stream.endsAt);
    if (Number.isNaN(at) || Number.isNaN(end)) return null;
    rates.push({
      recipient: stream.recipient,
      category: stream.category,
      at: Math.floor(at / 1_000),
      end: Math.floor(end / 1_000),
      ratePerWeek: stream.tokensPerWeek,
    });
  }
  return {
    cliffs,
    rates,
    unparsed: false,
    mismatch: false,
    includesForecast: facts.includesForecast,
  };
}

function share(tokens: number | null, circulating: number | null): number | null {
  if (tokens === null || circulating === null || circulating <= 0) return null;
  return round(pctOf(tokens, circulating), 2);
}

function emptyStateCounter(): Record<TokenomicsDataState, number> {
  return {
    available: 0,
    known_zero: 0,
    mapping_failed: 0,
    source_missing: 0,
    source_stale: 0,
    source_error: 0,
    matched_unparsed: 0,
  };
}