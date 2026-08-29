import { Injectable } from '@nestjs/common';
import { DISCOVERY } from '../../config/discovery';
import { pctOf, round } from '../money';
import { NEXT } from '../errors';
import { JobService } from '../jobs/job.service';
import { EvaluationService } from '../evaluation/evaluation.service';
import { UniverseService } from '../universe/universe.service';
import type { UniverseCandidate } from '../universe/universe.types';
import type { LayerFreshness, StatusNextAction, StatusReport } from './status.types';

const HOUR_MS = 3_600_000;
/** Числа старше суток — повод обновить цены, а не повод отказать. */
const PRICES_STALE_HOURS = 24;
const RESOLVED_TOKENOMICS = new Set(['available', 'known_zero']);

@Injectable()
export class StatusService {
  constructor(
    private readonly jobs: JobService,
    private readonly universe: UniverseService,
    private readonly evaluation: EvaluationService,
  ) {}

  /** Одна точка правды: что идёт, насколько свежо, какая выборка и что нажать. */
  async report(): Promise<StatusReport> {
    const job = this.jobs.snapshot();
    const snapshot = await this.universe.latest();

    if (snapshot === null) {
      return {
        job,
        data: {
          universe: { version: null, builtAt: null, ageDays: null, total: null },
          prices: empty(),
          tokenomics: empty(),
        },
        selection: {
          activeFilters: (await this.universe.status()).activeFilters,
          total: null,
          passed: null,
          dataTiers: null,
        },
        evaluation: null,
        nextAction: this.jobBusy(job.state) ?? {
          ...NEXT.buildUniverse,
          why: 'Состав вселенной ещё не собран: это единственный шаг, который тянет состав из интернета',
        },
      };
    }

    const status = await this.universe.status();
    const prices = freshnessOf(snapshot.candidates, (item) => item.marketAsOf, (item) => item.mcapCalcUsd !== null);
    const tokenomics = freshnessOf(
      snapshot.candidates,
      (item) => item.asOfTokenomics,
      (item) => RESOLVED_TOKENOMICS.has(item.tokenomicsState),
    );
    const compatibility = await this.evaluation.compatibility();

    return {
      job,
      data: {
        universe: {
          version: snapshot.version,
          builtAt: snapshot.builtAt,
          ageDays: status.ageDays,
          total: snapshot.candidates.length,
        },
        prices,
        tokenomics,
      },
      selection: {
        activeFilters: status.activeFilters,
        total: status.total,
        passed: status.passed,
        dataTiers: status.tiers,
      },
      evaluation: compatibility,
      nextAction:
        this.jobBusy(job.state) ??
        decide(status.ageDays, prices, tokenomics, compatibility),
    };
  }

  /** Идущая задача важнее любой свежести: второй прогон всё равно упрётся в слот. */
  private jobBusy(state: string): StatusNextAction | null {
    if (state !== 'running') return null;
    return { ...NEXT.status, why: 'Задача уже идёт: одновременно выполняется одна сетевая задача' };
  }
}

function empty(): LayerFreshness {
  return { asOf: null, ageHours: null, coveragePct: 0 };
}

/** Свежесть слоя: самая поздняя дата источника и доля покрытых строк по всей вселенной. */
function freshnessOf(
  candidates: readonly UniverseCandidate[],
  dateOf: (candidate: UniverseCandidate) => string | null,
  covered: (candidate: UniverseCandidate) => boolean,
): LayerFreshness {
  let latest: number | null = null;
  let count = 0;

  for (const candidate of candidates) {
    const raw = dateOf(candidate);
    const parsed = raw === null ? Number.NaN : Date.parse(raw);
    if (Number.isFinite(parsed) && (latest === null || parsed > latest)) latest = parsed;
    if (covered(candidate)) count += 1;
  }

  return {
    asOf: latest === null ? null : new Date(latest).toISOString(),
    ageHours: latest === null ? null : Math.max(0, Math.floor((Date.now() - latest) / HOUR_MS)),
    coveragePct: candidates.length === 0 ? 0 : round(pctOf(count, candidates.length), 2),
  };
}

/**
 * Порядок проверок — это порядок конвейера. Предложить оценку раньше, чем
 * собраны числа, значит предложить оценить вчерашние цены.
 */
function decide(
  ageDays: number | null,
  prices: LayerFreshness,
  tokenomics: LayerFreshness,
  evaluation: { compatible: { perToken: boolean; comparative: boolean } } | null,
): StatusNextAction {
  if (ageDays !== null && ageDays >= DISCOVERY.refreshDays) {
    return {
      method: 'POST',
      path: '/universe/refresh',
      body: { force: true },
      why: `Состав вселенной собран ${ageDays} дн. назад: перцентили ниш несравнимы между версиями`,
    };
  }
  if (prices.asOf === null || (prices.ageHours ?? 0) >= PRICES_STALE_HOURS) {
    return {
      ...NEXT.refreshPrices,
      why:
        prices.asOf === null
          ? 'Рыночных чисел по составу ещё нет'
          : `Цены и выручка обновлялись ${prices.ageHours} ч назад`,
    };
  }
  if (tokenomics.coveragePct === 0) {
    return { ...NEXT.collectTokenomics, why: 'Календарь разлоков не собирался: NHY не посчитан ни у кого' };
  }
  if (evaluation === null) {
    return { ...NEXT.runEvaluation, why: 'Кодовой оценки ещё не было ни разу' };
  }
  if (!evaluation.compatible.perToken) {
    return { ...NEXT.runEvaluation, why: 'Числа или профиль изменились после последней оценки' };
  }
  if (!evaluation.compatible.comparative) {
    return {
      ...NEXT.runEvaluation,
      why: 'Состав выборки изменился после последней оценки: пересчитается только sectorPosition',
    };
  }
  return { ...NEXT.latestEvaluation, why: 'Данные свежие, оценка совместима с текущей выборкой' };
}