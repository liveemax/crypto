import { Injectable } from '@nestjs/common';
import { DEFAULT_PROFILE } from '../../config/profiles';
import { DERIVATIVE_NAME, DISCOVERY } from '../../config/discovery';
import { sub } from '../money';
import type { AnalysisProfile, ScreenRule } from './profile.types';
import type {
  FunnelReport,
  FunnelStage,
  Tier,
  UniverseCandidate,
} from './universe.types';

@Injectable()
export class UniverseFilter {
  /** Прогоняет кандидатов по воронке и расставляет тиры. */
  apply(
    candidates: UniverseCandidate[],
    excluded: Set<string> = new Set(),
    profile: AnalysisProfile = DEFAULT_PROFILE,
  ): FunnelReport {
    const stages: FunnelStage[] = [];
    let alive = candidates.length;

    for (const item of candidates) {
      item.passed = true;
      item.tier = 'pool';
      item.rejectedAt = null;
      item.rejectReason = null;
    }

    for (const rule of profile.screen) {
      const incoming = alive;
      let dropped = 0;
      for (const item of candidates) {
        if (!item.passed) continue;
        if (passes(rule, item, excluded)) continue;
        item.passed = false;
        item.tier = 'rejected';
        item.rejectedAt = rule.stage;
        item.rejectReason = rejectionReason(rule, item);
        dropped += 1;
      }
      alive = incoming - dropped;
      stages.push({ stage: rule.stage, label: rule.label, incoming, dropped, kept: alive });
    }

    const tiers: Record<Tier, number> = { yield: 0, economics: 0, pool: 0, rejected: 0 };
    for (const item of candidates) {
      if (item.passed) item.tier = tierOf(item);
      tiers[item.tier] += 1;
    }

    return { total: candidates.length, stages, passed: alive, tiers };
  }
}

/** Выполняет одно правило профиля без побочных эффектов. */
function passes(
  rule: ScreenRule,
  item: UniverseCandidate,
  excluded: Set<string>,
): boolean {
  if (rule.kind === 'excluded') return !excluded.has(item.coingeckoId);
  if (rule.kind === 'pegged') {
    return (
      item.priceUsd === null ||
      Math.abs(sub(item.priceUsd, 1)) * 100 > DISCOVERY.pegBandPct
    );
  }
  if (rule.kind === 'derivative') return !DERIVATIVE_NAME.test(item.name);
  if (rule.kind === 'healthy') return item.sourceHealthy;
  if (rule.kind !== 'compare') return false;

  const actual = item[rule.field];
  if (actual === null) return rule.nullPolicy === 'pass';
  return rule.op === 'gte' ? actual >= rule.value : actual <= rule.value;
}

/** Даёт точную причину для базовых стадий и проверяемую причину для разовых правил. */
function rejectionReason(rule: ScreenRule, item: UniverseCandidate): string {
  switch (rule.stage) {
    case 'market_known':
      return 'Нет цены или circulating supply — капитализацию посчитать нельзя';
    case 'not_excluded':
      return 'Категория CoinGecko без собственной экономики токена';
    case 'not_pegged':
      return `Цена ${item.priceUsd} USD держится у единицы: это привязанный актив`;
    case 'not_derivative':
      return `Название «${item.name}»: цена отражает базовый актив, а не бизнес эмитента`;
    case 'liquid':
      return `Объём ${fmt(item.vol24hUsd)} USD за сутки: из позиции не выйти`;
    case 'turnover':
      return `Оборот ${item.turnoverPct ?? '—'}% от капитализации: торгов практически нет`;
    case 'float_sane':
      return (
        `В обращении ${item.floatPct}% эмиссии, полная оценка выше текущей ` +
        `в ${item.fdvToMcap ?? '—'} раз: остальное придёт разлоками`
      );
    case 'source_healthy':
      return 'Адаптер DeFiLlama помечен как сломанный, числа устарели';
    case 'not_loss_making':
      return `Выручка за 12 месяцев отрицательная: ${fmt(item.revenue12mUsd)} USD`;
    default:
      return compareReason(rule, item);
  }
}

function compareReason(rule: ScreenRule, item: UniverseCandidate): string {
  if (rule.kind !== 'compare') return `Не пройдена проверка «${rule.label}»`;
  const value = item[rule.field];
  const operator = rule.op === 'gte' ? 'не ниже' : 'не выше';
  return `${rule.field}: ${value ?? 'нет данных'}, требуется ${operator} ${rule.value}`;
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
