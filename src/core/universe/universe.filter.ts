import { Injectable } from '@nestjs/common';
import { DERIVATIVE_NAME, DISCOVERY } from '../../config/discovery';
import { sub } from '../money';
import { FunnelReport, FunnelStage, Tier, UniverseCandidate } from './universe.types';

interface Check {
  stage: string;
  label: string;
  /** true — кандидат проходит проверку. */
  test: (candidate: UniverseCandidate, excluded: Set<string>) => boolean;
  reason: (candidate: UniverseCandidate) => string;
}

const { minVol24hUsd, minTurnoverPct, pegBandPct, minFloatPct } = DISCOVERY;
/**
 * Воронка отсеивает откровенный шлак и не более того.
 * Порогов оценки здесь нет: минимальная выручка и максимальный P/Rev — это
 * хард-фильтры агента screener (шаг 06). Дублировать их на этом шаге значит
 * потерять Ethereum и Solana до того, как их кто-либо посмотрит.
 */
const CHECKS: Check[] = [
  {
    stage: 'market_known',
    label: 'Известны цена и circulating supply',
    test: (item) => item.mcapCalcUsd !== null && item.mcapCalcUsd > 0,
    reason: () => 'Нет цены или circulating supply — капитализацию посчитать нельзя',
  },
  {
    stage: 'not_excluded',
    label: 'Не стейблкоин, не обёртка, не LST-репрезентация, не мемкоин',
    test: (item, excluded) => !excluded.has(item.coingeckoId),
    reason: () => 'Категория CoinGecko без собственной экономики токена',
  },
  {
    stage: 'not_pegged',
    label: `Цена не привязана к 1 USD (коридор ±${pegBandPct}%)`,
    test: (item) =>
      item.priceUsd === null || Math.abs(sub(item.priceUsd, 1)) * 100 > pegBandPct,
    reason: (item) =>
      `Цена ${item.priceUsd} USD держится у единицы: это привязанный актив`,
  },
  {
    stage: 'not_derivative',
    label: 'Не производная обёртка: wrapped, staked, bridged, peg',
    test: (item) => !DERIVATIVE_NAME.test(item.name),
    reason: (item) =>
      `Название «${item.name}»: цена отражает базовый актив, а не бизнес эмитента`,
  },
  {
    stage: 'liquid',
    label: `Суточный объём не ниже ${minVol24hUsd.toLocaleString('ru-RU')} USD`,
    test: (item) => (item.vol24hUsd ?? 0) >= minVol24hUsd,
    reason: (item) =>
      `Объём ${fmt(item.vol24hUsd)} USD за сутки: из позиции не выйти`,
  },
  {
    stage: 'turnover',
    label: `Оборот не ниже ${minTurnoverPct}% капитализации за сутки`,
    test: (item) => (item.turnoverPct ?? 0) >= minTurnoverPct,
    reason: (item) =>
      `Оборот ${item.turnoverPct ?? '—'}% от капитализации: торгов практически нет`,
  },
  {
    stage: 'float_sane',
    label: `В обращении не меньше ${minFloatPct}% эмиссии`,
    // Неизвестная эмиссия не наказывается: «неизвестно» не равно «плохо».
    test: (item) => item.floatPct === null || item.floatPct >= minFloatPct,
    reason: (item) =>
      `В обращении ${item.floatPct}% эмиссии, полная оценка выше текущей ` +
      `в ${item.fdvToMcap ?? '—'} раз: остальное придёт разлоками`,
  },
  {
    stage: 'source_healthy',
    label: 'Финансовый источник не сломан',
    test: (item) => item.sourceHealthy,
    reason: () => 'Адаптер DeFiLlama помечен как сломанный, числа устарели',
  },
  {
    stage: 'not_loss_making',
    // Предохранитель, а не фильтр: отрицательная выручка встречается только у
    // протоколов с allowNegativeValue. Настоящая прибыльность — выручка минус
    // стоимость стимулов — считается на шаге 10, здесь этих данных нет.
    label: 'Предохранитель: выручка не отрицательная',
    test: (item) => item.revenue12mUsd === null || item.revenue12mUsd >= 0,
    reason: (item) =>
      `Выручка за 12 месяцев отрицательная: ${fmt(item.revenue12mUsd)} USD`,
  },
];

@Injectable()
export class UniverseFilter {
  /** Прогоняет кандидатов по воронке и расставляет тиры. */
  apply(candidates: UniverseCandidate[], excluded: Set<string> = new Set()): FunnelReport {
    const stages: FunnelStage[] = [];
    let alive = candidates.length;

    for (const item of candidates) {
      item.passed = true;
      item.tier = 'pool';
      item.rejectedAt = null;
      item.rejectReason = null;
    }

    for (const check of CHECKS) {
      const incoming = alive;
      let dropped = 0;
      for (const item of candidates) {
        if (!item.passed) continue;
        if (check.test(item, excluded)) continue;
        item.passed = false;
        item.tier = 'rejected';
        item.rejectedAt = check.stage;
        item.rejectReason = check.reason(item);
        dropped += 1;
      }
      alive = incoming - dropped;
      stages.push({ stage: check.stage, label: check.label, incoming, dropped, kept: alive });
    }

    const tiers: Record<Tier, number> = { yield: 0, economics: 0, pool: 0, rejected: 0 };
    for (const item of candidates) {
      if (item.passed) item.tier = tierOf(item);
      tiers[item.tier] += 1;
    }

    return { total: candidates.length, stages, passed: alive, tiers };
  }
}

/**
 * Тир, а не отсев: отсутствие финансовых данных — повод не звать агентов,
 * а не повод выбросить токен из вселенной.
 */
function tierOf(item: UniverseCandidate): Tier {
  if ((item.holdersRevenue12mUsd ?? 0) > 0) return 'yield';
  if ((item.revenue12mUsd ?? 0) > 0) return 'economics';
  return 'pool';
}

function fmt(value: number | null): string {
  return value === null ? '—' : Math.round(value).toLocaleString('ru-RU');
}
