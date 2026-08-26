import { Injectable } from '@nestjs/common';
import { DEFAULT_PROFILE } from '../config/profiles';
import { div, mul, round, sub } from '../core/money';
import { StoreService } from '../core/store/store.service';
import { AgentContext, AgentResult, SnapshotRow } from '../core/types';
import { metric, ValidateService } from '../core/validate/validate.service';
import { BaseAgent } from './base.agent';

/** Проверяет базовую экономику кандидата без сетевых запросов и участия LLM. */
@Injectable()
export class ScreenerAgent extends BaseAgent {
  readonly name = 'screener';
  readonly title = 'Дешевизна и базовые фильтры';
  readonly needs: (keyof SnapshotRow)[] = ['mcapUsd'];

  constructor(validate: ValidateService, store: StoreService) {
    super(validate, store);
  }

  /** Собирает проверяемый результат из уже рассчитанного кандидата вселенной. */
  protected async analyze(
    _token: string,
    row: SnapshotRow,
    ctx: AgentContext,
  ): Promise<Partial<AgentResult>> {
    const candidate = ctx.candidate;
    if (!candidate) {
      return {
        missing: ['candidate'],
        notes: 'Кандидат отсутствует в снимке вселенной. Оценка невозможна.',
      };
    }

    const thresholds = (ctx.profile ?? DEFAULT_PROFILE).thresholds;
    const checks = {
      hasRevenue: candidate.revenue12mUsd !== null,
      revenueAboveMin:
        candidate.revenue12mUsd !== null &&
        candidate.revenue12mUsd >= thresholds.minAnnualRevenueUsd,
      mcapAboveMin:
        candidate.mcapCalcUsd !== null && candidate.mcapCalcUsd >= thresholds.minMcapUsd,
      pRevSane: candidate.pRev !== null && candidate.pRev <= thresholds.maxPRev,
    };
    const reasons: Record<keyof typeof checks, string> = {
      hasRevenue: 'Нет данных о выручке за 12 месяцев',
      revenueAboveMin: `Выручка ниже ${thresholds.minAnnualRevenueUsd} USD в год`,
      mcapAboveMin: `Капитализация ниже ${thresholds.minMcapUsd} USD`,
      pRevSane: `P/Rev выше ${thresholds.maxPRev} или неизвестен`,
    };
    const failedChecks = (Object.keys(checks) as (keyof typeof checks)[])
      .filter((name) => !checks[name])
      .map((name) => reasons[name]);

    const score =
      candidate.revenue12mUsd === null || candidate.pRev === null
        ? null
        : round(
            Math.max(
              0,
              Math.min(100, sub(100, mul(100, div(candidate.pRev, thresholds.maxPRev)))),
            ),
            1,
          );

    return {
      verdict: {
        passed: failedChecks.length === 0,
        failedChecks,
        revenueBasis: candidate.revenueBasis,
        takeRatePct: candidate.takeRatePct,
        takeRateExplanation:
          'Take rate показывает долю пользовательских комиссий, которая остаётся протоколу.',
      },
      score,
      metrics: {
        mcapUsd: metric(candidate.mcapCalcUsd, candidate.marketSource, candidate.marketAsOf, 'USD'),
        fdvUsd: metric(candidate.fdvUsd, candidate.marketSource, candidate.marketAsOf, 'USD'),
        revenue12mUsd: metric(
          candidate.revenue12mUsd,
          candidate.revenueSource,
          row.asOfFees ?? null,
          'USD',
        ),
        fees12mUsd: metric(
          candidate.fees12mUsd,
          candidate.revenueSource,
          row.asOfFees ?? null,
          'USD',
        ),
        pRev: metric(candidate.pRev, candidate.revenueSource, row.asOfFees ?? null, 'x'),
        fdvRev: metric(candidate.fdvRev, candidate.revenueSource, row.asOfFees ?? null, 'x'),
        takeRatePct: metric(
          candidate.takeRatePct,
          candidate.revenueSource,
          row.asOfFees ?? null,
          '%',
        ),
        tvlUsd: metric(candidate.tvlUsd, candidate.tvlSource, row.asOfTvl ?? null, 'USD'),
      },
      missing:
        candidate.revenue12mUsd === null
          ? ['revenue12mUsd', 'Оценка относительно выручки недоступна']
          : [],
      notes:
        candidate.revenue12mUsd === null
          ? 'Выручка неизвестна: балл не рассчитан, нулевое значение не подставлено.'
          : '',
    };
  }
}
