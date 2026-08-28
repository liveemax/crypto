import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { BUILTIN_PROFILES, DEFAULT_PROFILE, getProfile } from '../../config/profiles';
import { add, div, round } from '../money';
import { StoreService } from '../store/store.service';
import { sectorPositions } from '../universe/alpha';
import type { SectorPosition } from '../universe/alpha';
import { SUPPLY_FIELD, evaluationRankConfig } from './evaluation.constants';
import type { AlphaConfig, AnalysisProfile } from '../universe/profile.types';
import { UniverseService } from '../universe/universe.service';
import type { CandidateView, UniverseView } from '../universe/universe.types';
import { evaluateSectorPosition } from './sector-position';
import { evaluateTokenomics } from './tokenomics-block';
import { evaluateValuation } from './valuation';
import { inputHashes } from './evaluation.hash';
import {
  EVALUATION_COMPONENTS,
  type CandidateEvaluation,
  type EvaluationBlock,
  type EvaluationComponentName,
  type EvaluationContext,
  type EvaluationListQuery,
  type EvaluationListResponse,
  type EvaluationRun,
  type EvaluationRunRequest,
  type EvaluationRunResponse,
  type EvaluationSummary,
  type EvaluationSummaryRow,
  type EvaluationTokenResponse,
} from './evaluation.types';

const STORE_KIND = 'evaluations';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class EvaluationService {
  constructor(
    private readonly store: StoreService,
    private readonly universe: UniverseService,
  ) {}

  /** Оценивает всю текущую выборку одним проходом: ни сети, ни слота задачи. */
  async run(request: EvaluationRunRequest = {}): Promise<EvaluationRunResponse> {
    const profile = this.resolveProfile(request.profileId);
    const view = await this.universe.view();
    const selection = view.candidates.filter((candidate) => candidate.passed);

    const alphaOn = view.activeFilters.alpha.enabled && view.activeFilters.alpha.config !== null;
    const rankBy: AlphaConfig = alphaOn
      ? (view.activeFilters.alpha.config as AlphaConfig)
      : profile.alpha;
    const screen = view.activeFilters.screen.enabled
      ? (view.activeFilters.screen.profile?.screen ?? null)
      : null;

    const hashes = inputHashes({
      universeVersion: view.universeVersion,
      builtAt: view.builtAt,
      profile,
      universe: view.candidates,
      selection,
      activeFilters: view.activeFilters,
      rankBy,
    });

    const previous = await this.store.loadRun<EvaluationRun>(STORE_KIND);
    const samePerToken =
      request.refresh !== true &&
      previous !== null &&
      previous.evaluationProfileId === profile.id &&
      previous.inputHashes.perToken === hashes.perToken;
    const sameComparative =
      samePerToken && previous !== null && previous.inputHashes.comparative === hashes.comparative;
    const before = new Map(
      (samePerToken && previous !== null ? previous.candidates : []).map(
        (item) => [item.coingeckoId, item] as const,
      ),
    );

    const warnings: string[] = [];
    const evaluationRank = evaluationRankConfig(rankBy);
    const positions = this.positionsOf(selection, evaluationRank, warnings);

    // Балл по шкале одного профиля рядом с отбором по порогам другого — два разных
    // ответа на один вопрос, и молча их смешивать нельзя.
    const screenProfileId = view.activeFilters.screen.enabled
      ? view.activeFilters.screen.profile?.id ?? null
      : null;
    if (screenProfileId !== null && screenProfileId !== profile.id) {
      warnings.push(
        `Оценка по профилю ${profile.id} (maxPRev ${profile.thresholds.maxPRev}), ` +
          `а выборка отобрана профилем ${screenProfileId}. Баллы valuation считаются ` +
          'по чужой шкале: передайте profileId явно, если это не задумано',
      );
    }

    let reused = 0;
    let recomputed = 0;
    let recomputedSector = 0;

    const candidates: CandidateEvaluation[] = selection.map((candidate) => {
      const old = before.get(candidate.coingeckoId);
      const reusable = old !== undefined;
      if (reusable) reused += 1;
      else recomputed += 1;

      const valuation = reusable ? old.valuation : evaluateValuation(candidate, profile, screen);

      // tokenomics сравнивает навес внутри ниши, поэтому зависит от состава
      // группы так же, как sectorPosition, и переиспользуется по comparative.
      let tokenomics: EvaluationBlock;
      let sectorPosition: EvaluationBlock;
      if (reusable && sameComparative) {
        tokenomics = old.tokenomics;
        sectorPosition = old.sectorPosition;
      } else {
        const position = positions.get(candidate.coingeckoId) ?? null;
        tokenomics = evaluateTokenomics(candidate, supplyPercentileOf(position));
        sectorPosition = evaluateSectorPosition(
          candidate,
          position,
          evaluationRank,
          candidate.alpha,
          alphaOn,
        );
        recomputedSector += 1;
      }

      return {
        coingeckoId: candidate.coingeckoId,
        ticker: candidate.ticker,
        name: candidate.name,
        comparisonGroup: candidate.comparisonGroup,
        dataTier: candidate.tier,
        valuation,
        tokenomics,
        sectorPosition,
      };
    });

    if (selection.length === 0) {
      warnings.push(
        'Активная выборка пуста: все кандидаты отсеяны включёнными фильтрами. ' +
          'Оценивать нечего, это не ошибка расчёта.',
      );
    }

    const run: EvaluationRun = {
      runId: `eval_${new Date().toISOString().replace(/[:.]/g, '-')}_${profile.id}`,
      createdAt: new Date().toISOString(),
      universeVersion: view.universeVersion,
      builtAt: view.builtAt,
      activeFilters: view.activeFilters,
      evaluationProfileId: profile.id,
      inputHashes: hashes,
      inputCount: view.candidates.length,
      evaluatedCount: candidates.length,
      dataGapCount: candidates.filter((item) => gapOf(item)).length,
      warnings,
      summaries: summariesOf(candidates),
      candidates,
    };

    await this.store.saveRun(STORE_KIND, run.runId, run);

    return {
      ...this.envelope(run, {}),
      inputCount: run.inputCount,
      evaluatedCount: run.evaluatedCount,
      dataGapCount: run.dataGapCount,
      inputHashes: run.inputHashes,
      warnings: run.warnings,
      reuse: {
        perToken: samePerToken,
        comparative: sameComparative,
        reusedTokens: reused,
        recomputedTokens: recomputed,
        recomputedSectorPosition: recomputedSector,
        note: samePerToken
          ? sameComparative
            ? 'Числа и состав группы сравнения те же: прогон переиспользован целиком.'
            : 'Состав группы сравнения изменился: пересчитаны sectorPosition и tokenomics, ' +
              'оба сравнивают внутри ниши. valuation взят как есть.'
          : 'Числа или профиль изменились: пересчитано всё.',
      },
    };
  }

  /** Последний сохранённый прогон страницами; расчёта не запускает. */
  async list(query: EvaluationListQuery = {}): Promise<EvaluationListResponse> {
    const run = await this.store.loadRun<EvaluationRun>(STORE_KIND);
    if (run === null) {
      throw new ConflictException({
        code: 'evaluation_missing',
        message: 'Кодовой оценки ещё не было.',
        details: { expected: 'evaluation run', actual: null },
        nextAction: { method: 'POST', path: '/evaluation/run', body: {} },
      });
    }
    return this.envelope(run, query);
  }

  /** Три компонента одного токена; токена в прогоне не было — 200 с причиной. */
  async token(token: string): Promise<EvaluationTokenResponse> {
    const run = await this.store.loadRun<EvaluationRun>(STORE_KIND);
    if (run === null) {
      return {
        status: 'not_in_selection',
        context: null,
        runId: null,
        reason: 'Кодовой оценки ещё не было ни разу.',
        nextAction: { method: 'POST', path: '/evaluation/run', body: {} },
        evaluation: null,
      };
    }

    const wanted = token.trim().toLowerCase();
    const matches = run.candidates.filter(
      (item) => item.coingeckoId.toLowerCase() === wanted || item.ticker.toLowerCase() === wanted,
    );
    if (matches.length > 1) {
      throw new ConflictException({
        code: 'ambiguous_ticker',
        message: `Тикер ${token} принадлежит нескольким активам.`,
        details: { candidates: matches.map((item) => item.coingeckoId) },
        nextAction: { method: 'GET', path: `/evaluation/${matches[0].coingeckoId}`, body: {} },
      });
    }

    const context = contextOf(run);
    if (matches.length === 1) {
      return {
        status: 'evaluated',
        context,
        runId: run.runId,
        reason: null,
        nextAction: null,
        evaluation: matches[0],
      };
    }

    return {
      status: 'not_in_selection',
      context,
      runId: run.runId,
      reason: await this.absenceReason(wanted),
      nextAction: { method: 'GET', path: '/universe/funnel', body: {} },
      evaluation: null,
    };
  }

  /** Почему токена нет в прогоне: воронка, альфа или отсутствие во вселенной. */
  private async absenceReason(wanted: string): Promise<string> {
    const view = await this.universe.view();
    const found = view.candidates.find(
      (item) => item.coingeckoId.toLowerCase() === wanted || item.ticker.toLowerCase() === wanted,
    );
    if (found === undefined) return 'Токена нет в текущем снимке вселенной.';
    if (found.passed) return 'Токен прошёл фильтры, но появился после последнего прогона оценки.';
    return `Отсеян на стадии ${found.rejectedAt ?? '—'}: ${found.rejectReason ?? 'причина не записана'}`;
  }

  /**
   * Перцентили считаются по конфигурации оценки всегда, включена альфа или нет.
   * Её собственный rankBy — семь выручных осей: он годится, чтобы отсеивать
   * лидеров ниши, и не годится, чтобы описать положение токена без выручки.
   * Решение самой альфы едет рядом, в verdict.filterDecision.
   */
  private positionsOf(
    selection: CandidateView[],
    rankBy: AlphaConfig,
    warnings: string[],
  ): Map<string, SectorPosition | null> {
    const positions = new Map<string, SectorPosition | null>();
    const outliers: string[] = [];
    for (const [id, position] of sectorPositions(selection, rankBy, outliers)) {
      positions.set(id, position);
    }
    if (outliers.length > 0) {
      warnings.push(
        `Выброс revenuePerTvlPct не участвует в перцентилях: ${outliers.slice(0, 12).join(', ')}`,
      );
    }
    return positions;
  }

  private envelope(run: EvaluationRun, query: EvaluationListQuery): EvaluationListResponse {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(query.offset ?? 0, 0);
    const page = run.candidates.slice(offset, offset + limit);

    return {
      context: contextOf(run),
      runId: run.runId,
      createdAt: run.createdAt,
      evaluationProfileId: run.evaluationProfileId,
      summaries: run.summaries,
      pagination: {
        offset,
        limit,
        total: run.candidates.length,
        hasMore: offset + page.length < run.candidates.length,
      },
      items: query.view === 'full' ? page : page.map(summaryRow),
    };
  }

  private resolveProfile(id?: string): AnalysisProfile {
    const wanted = id?.trim();
    if (!wanted) return DEFAULT_PROFILE;
    const profile = getProfile(wanted);
    if (!profile) {
      throw new BadRequestException(
        `Неизвестный profileId: ${wanted}. Доступные: ${BUILTIN_PROFILES.map((item) => item.id).join(', ')}`,
      );
    }
    return profile;
  }
}

/** Перцентиль навеса из общего расчёта: второй его источник разъехался бы с первым. */
function supplyPercentileOf(position: SectorPosition | null): number | null {
  return position?.percentiles.find((item) => item.field === SUPPLY_FIELD)?.percentile ?? null;
}

function contextOf(run: EvaluationRun): EvaluationContext {
  return {
    universeVersion: run.universeVersion,
    builtAt: run.builtAt,
    activeFilters: run.activeFilters,
    asOf: run.createdAt,
  };
}

function gapOf(item: CandidateEvaluation): boolean {
  return EVALUATION_COMPONENTS.some((name) => item[name].score === null);
}

function summaryRow(item: CandidateEvaluation): EvaluationSummaryRow {
  const scores = {} as Record<EvaluationComponentName, number | null>;
  const quality = {} as Record<EvaluationComponentName, number>;
  const missing = new Set<string>();
  for (const name of EVALUATION_COMPONENTS) {
    scores[name] = item[name].score;
    quality[name] = round(item[name].dataQuality, 3);
    for (const field of item[name].missing) missing.add(field);
  }
  return {
    coingeckoId: item.coingeckoId,
    ticker: item.ticker,
    name: item.name,
    comparisonGroup: item.comparisonGroup,
    dataTier: item.dataTier,
    scores,
    dataQuality: quality,
    hardFilterFail: item.tokenomics.verdict.hardFilterFail === true,
    missing: [...missing].sort(),
  };
}

function summariesOf(
  candidates: CandidateEvaluation[],
): Record<EvaluationComponentName, EvaluationSummary> {
  const summaries = {} as Record<EvaluationComponentName, EvaluationSummary>;
  for (const component of EVALUATION_COMPONENTS) {
    const blocks = candidates.map((item) => item[component]);
    const scored = blocks.filter((item) => item.score !== null);
    const scoreTotal = scored.reduce((sum, item) => add(sum, item.score ?? 0), 0);
    const qualityTotal = blocks.reduce((sum, item) => add(sum, item.dataQuality), 0);
    summaries[component] = {
      component,
      scored: scored.length,
      skipped: blocks.length - scored.length,
      hardFilterFail: blocks.filter((item) => item.verdict.hardFilterFail === true).length,
      avgScore: scored.length === 0 ? null : round(div(scoreTotal, scored.length), 1),
      avgDataQuality: blocks.length === 0 ? 0 : round(div(qualityTotal, blocks.length), 3),
    };
  }
  return summaries;
}