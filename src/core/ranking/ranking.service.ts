import { Injectable } from '@nestjs/common';
import { resolveProfile } from '../../config/profiles';
import { RESEARCH_DISCLAIMER } from '../disclaimer';
import { conflict, notFound, NEXT } from '../errors';
import { paginate } from '../envelope';
import { EvaluationService } from '../evaluation/evaluation.service';
import type { EvaluationRun } from '../evaluation/evaluation.types';
import { StoreService } from '../store/store.service';
import { rankCandidate } from './ranking.candidate';
import { RANKING_FORMULA_VERSION, SENSITIVITY_FORMULA_VERSION } from './ranking.constants';
import { rankingJournalRow, RANKING_JOURNAL_HEADER } from './ranking.journal';
import { renderRankingReport } from './ranking.report';
import { rankingSummaryRow } from './ranking.summary';
import { buildScenarios, sensitivityReportOf } from './sensitivity';
import type { SensitivityResult, SensitivityRunRequest } from './sensitivity.types';
import type {
  RankedCandidate,
  RankingListQuery,
  RankingListResponse,
  RankingRun,
  RankingRunRequest,
  RankingRunResponse,
  RankTier,
} from './ranking.types';

const STORE_KIND = 'rankings';
const JOURNAL_NAME = 'journal';
const EMPTY_TIERS: Record<RankTier, number> = { A: 0, B: 0, C: 0, watchlist: 0 };

@Injectable()
export class RankingService {
  constructor(
    private readonly store: StoreService,
    private readonly evaluation: EvaluationService,
  ) {}

  /**
   * Строит и сохраняет ranking run поверх совместимой evaluation. Полностью
   * локально и синхронно: JobService не занимается, сеть не вызывается —
   * evaluation внутри тоже считается локально.
   */
  async run(request: RankingRunRequest = {}): Promise<RankingRun> {
    const profile = resolveProfile(request.profileId);
    const { run, evaluationRecomputed } = await this.evaluationRunFor(profile.id);

    const candidates: RankedCandidate[] = run.candidates.map((candidate) =>
      rankCandidate(candidate, profile),
    );

    const rankingRun: RankingRun = {
      runId: `rank_${new Date().toISOString().replace(/[:.]/g, '-')}_${profile.id}`,
      createdAt: new Date().toISOString(),
      universeVersion: run.universeVersion,
      builtAt: run.builtAt,
      activeFilters: run.activeFilters,
      rankingProfileId: profile.id,
      formulaVersions: { ...run.formulaVersions, ranking: RANKING_FORMULA_VERSION },
      inputHashes: run.inputHashes,
      evaluationRunId: run.runId,
      evaluationRecomputed,
      candidateCount: candidates.length,
      tiers: tiersOf(candidates),
      notEvaluated: run.notEvaluated,
      candidates,
    };

    await this.store.saveRun(STORE_KIND, rankingRun.runId, rankingRun);

    // Отчёт и журнал пишутся на каждый прогон, а не только через HTTP: run() —
    // единственная точка, где ranking run фактически посчитан и сохранён.
    const report = renderRankingReport(rankingRun);
    await this.store.saveReport(STORE_KIND, rankingRun.runId, report);
    await this.store.appendJournal(
      JOURNAL_NAME,
      rankingRun.runId,
      rankingJournalRow(rankingRun),
      RANKING_JOURNAL_HEADER,
    );

    return rankingRun;
  }

  /**
   * HTTP-обёртка над run(): тот же прогон, но ответ POST /ranking/run — страница,
   * а не сотни карточек разом. run() остаётся полным ради внутренних потребителей
   * и тестов, которым нужны все кандидаты без пагинации.
   */
  async runPaged(request: RankingRunRequest = {}): Promise<RankingRunResponse> {
    const run = await this.run(request);
    return {
      ...this.envelope(run, {}),
      evaluationRunId: run.evaluationRunId,
      evaluationRecomputed: run.evaluationRecomputed,
      candidateCount: run.candidateCount,
      inputHashes: run.inputHashes,
    };
  }

  /** Последний сохранённый ranking run страницами; расчёта не запускает. */
  async list(query: RankingListQuery = {}): Promise<RankingListResponse> {
    const run = await this.store.loadRun<RankingRun>(STORE_KIND);
    if (run === null) {
      throw conflict(
        'ranking_missing',
        'Рейтинга ещё не было ни разу.',
        { expected: 'ranking run', actual: null },
        NEXT.runRanking,
      );
    }
    return this.envelope(run, query);
  }

  /**
   * ШАГ 16.2: насколько итог зависит от весов профиля. Читает уже сохранённый
   * ranking run по runId и прогоняет его кандидатов через 25 детерминированных
   * весовых сценариев. Ничего не пересчитывает и не сохраняет: ни evaluation,
   * ни новый ranking run, сети и JobService тоже нет.
   */
  async sensitivity(request: SensitivityRunRequest): Promise<SensitivityResult> {
    const run = await this.store.loadRunById<RankingRun>(STORE_KIND, request.runId);
    if (run === null) {
      throw notFound(
        'ranking_run_missing',
        `Ranking run ${request.runId} не найден.`,
        { runId: request.runId },
        NEXT.latestRanking,
      );
    }

    const profile = resolveProfile(run.rankingProfileId);
    const scenarios = buildScenarios(profile.weights);
    const { results, summary } = sensitivityReportOf(run.candidates, scenarios, profile);
    const { page, pagination } = paginate(results, request);

    return {
      context: {
        universeVersion: run.universeVersion,
        builtAt: run.builtAt,
        activeFilters: run.activeFilters,
        asOf: run.createdAt,
      },
      runId: run.runId,
      rankingProfileId: run.rankingProfileId,
      formulaVersion: SENSITIVITY_FORMULA_VERSION,
      baselineWeights: profile.weights,
      scenarios,
      summary,
      pagination,
      items: page,
      disclaimer: RESEARCH_DISCLAIMER,
    };
  }

  /** Уже сохранённый markdown-отчёт по runId; ничего не пересчитывает. */
  async report(runId: string): Promise<string> {
    const text = await this.store.loadReport(STORE_KIND, runId);
    if (text === null) {
      throw notFound(
        'ranking_report_missing',
        `Отчёт для runId ${runId} не найден.`,
        { runId },
        NEXT.latestRanking,
      );
    }
    return text;
  }

  private envelope(run: RankingRun, query: RankingListQuery): RankingListResponse {
    const { page, pagination } = paginate(run.candidates, query);
    return {
      context: {
        universeVersion: run.universeVersion,
        builtAt: run.builtAt,
        activeFilters: run.activeFilters,
        asOf: run.createdAt,
      },
      runId: run.runId,
      createdAt: run.createdAt,
      rankingProfileId: run.rankingProfileId,
      formulaVersions: run.formulaVersions,
      tiers: run.tiers,
      notEvaluated: run.notEvaluated,
      pagination,
      items: query.view === 'full' ? page : page.map(rankingSummaryRow),
      disclaimer: RESEARCH_DISCLAIMER,
    };
  }

  /**
   * Совместимая evaluation того же профиля переиспользуется целиком без нового
   * прогона; иначе — пересчитывается через EvaluationService.run(), который
   * сам переиспользует те покомпонентные части, что не изменились.
   */
  private async evaluationRunFor(
    profileId: string,
  ): Promise<{ run: EvaluationRun; evaluationRecomputed: boolean }> {
    const compatibility = await this.evaluation.compatibility();
    const compatible =
      compatibility !== null &&
      compatibility.evaluationProfileId === profileId &&
      compatibility.compatible.perToken &&
      compatibility.compatible.comparative;

    if (compatible) {
      const run = await this.evaluation.latestRun();
      if (run !== null) return { run, evaluationRecomputed: false };
    }

    await this.evaluation.run({ profileId });
    const run = await this.evaluation.latestRun();
    if (run === null) {
      throw new Error('Evaluation не сохранилась после пересчёта: дефект EvaluationService.run().');
    }
    return { run, evaluationRecomputed: true };
  }
}

function tiersOf(candidates: RankedCandidate[]): Record<RankTier, number> {
  const tiers = { ...EMPTY_TIERS };
  for (const candidate of candidates) tiers[candidate.rankTier] += 1;
  return tiers;
}
