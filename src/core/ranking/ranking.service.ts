import { Injectable } from '@nestjs/common';
import { resolveProfile } from '../../config/profiles';
import { EvaluationService } from '../evaluation/evaluation.service';
import type { EvaluationRun } from '../evaluation/evaluation.types';
import { StoreService } from '../store/store.service';
import { rankCandidate } from './ranking.candidate';
import { RANKING_FORMULA_VERSION } from './ranking.constants';
import type { RankedCandidate, RankingRun, RankingRunRequest, RankTier } from './ranking.types';

const STORE_KIND = 'rankings';
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
    return rankingRun;
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
