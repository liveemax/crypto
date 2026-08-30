import { DEEP_VALUE_PROFILE } from '../src/config/profiles';
import { RESEARCH_DISCLAIMER } from '../src/core/disclaimer';
import { NOT_EVALUATED } from '../src/core/evaluation/evaluation.constants';
import type { CandidateEvaluation, EvaluationBlock, EvaluationComponentName } from '../src/core/evaluation/evaluation.types';
import { rankCandidate } from '../src/core/ranking/ranking.candidate';
import { renderRankingReport } from '../src/core/ranking/ranking.report';
import type { RankedCandidate, RankingRun, RankTier } from '../src/core/ranking/ranking.types';
import type { ActiveFilterState } from '../src/core/universe/filter-state.types';

const ACTIVE_FILTERS: ActiveFilterState = {
  screen: { enabled: true, profileId: 'deep-value', profile: null },
  alpha: { enabled: false, profileId: null, config: null },
};

function block(
  component: EvaluationComponentName,
  score: number | null,
  metrics: EvaluationBlock['metrics'] = {},
  verdict: Record<string, unknown> = {},
  missing: string[] = [],
): EvaluationBlock {
  return { component, title: component, verdict, score, metrics, dataQuality: 1, missing, notes: '' };
}

function candidateEval(overrides: Partial<CandidateEvaluation> = {}): CandidateEvaluation {
  return {
    coingeckoId: 'aave',
    ticker: 'AAVE',
    name: 'Aave',
    comparisonGroup: 'lending',
    dataTier: 'yield',
    valuation: block('valuation', 60, {
      pRev: { value: 12.5, unit: 'x', sourceUrl: 'https://defillama.com/protocol/aave-v3', asOf: '2026-08-27T00:00:00.000Z' },
    }, { passed: true }),
    tokenomics: block('tokenomics', 70, {}, { hardFilterFail: false }),
    sectorPosition: block('sectorPosition', 80, {
      unlock12mPct: { value: null, unit: '%', sourceUrl: null, asOf: null },
    }, {}, ['unlock12mPct']),
    notEvaluated: NOT_EVALUATED,
    riskFlags: [],
    flagPenalty: 0,
    riskMissing: [],
    ...overrides,
  };
}

function tiersOf(candidates: RankedCandidate[]): Record<RankTier, number> {
  const tiers: Record<RankTier, number> = { A: 0, B: 0, C: 0, watchlist: 0 };
  for (const candidate of candidates) tiers[candidate.rankTier] += 1;
  return tiers;
}

function runOf(candidates: RankedCandidate[], overrides: Partial<RankingRun> = {}): RankingRun {
  return {
    runId: 'rank_2026-08-30T00-00-00-000Z_deep-value',
    createdAt: '2026-08-30T09:00:00.000Z',
    universeVersion: '2026-08-29',
    builtAt: '2026-08-29T06:00:00.000Z',
    activeFilters: ACTIVE_FILTERS,
    rankingProfileId: 'deep-value',
    formulaVersions: {
      businessScale: 'business-scale-v1',
      valuation: 'sector-valuation-v1',
      ranking: 'ranking-composite-v1',
    },
    inputHashes: { perToken: 'hash-a', comparative: 'hash-b' },
    evaluationRunId: 'eval_2026-08-30T09-00-00-000Z_deep-value',
    evaluationRecomputed: false,
    candidateCount: candidates.length,
    tiers: tiersOf(candidates),
    notEvaluated: NOT_EVALUATED,
    candidates,
    ...overrides,
  };
}

describe('renderRankingReport(): воспроизводимый markdown-отчёт шага 16.1', () => {
  it('содержит дисклеймер дословно, контекст, профиль, веса, версии формул и тиры', () => {
    const ranked = rankCandidate(candidateEval(), DEEP_VALUE_PROFILE);
    const run = runOf([ranked]);
    const report = renderRankingReport(run);

    // Дословно и в начале, и в конце отчёта.
    expect(report.split(RESEARCH_DISCLAIMER).length - 1).toBeGreaterThanOrEqual(2);
    expect(report).toContain(run.runId);
    expect(report).toContain(run.universeVersion);
    expect(report).toContain(run.builtAt);
    expect(report).toContain('deep-value');
    expect(report).toContain(DEEP_VALUE_PROFILE.title);
    expect(report).toContain('business-scale-v1');
    expect(report).toContain('sector-valuation-v1');
    expect(report).toContain('ranking-composite-v1');
    expect(report).toContain(`tokenomics: ${DEEP_VALUE_PROFILE.weights.tokenomics}`);
    expect(report).toContain(`valuation: ${DEEP_VALUE_PROFILE.weights.valuation}`);
    expect(report).toContain(`sectorPosition: ${DEEP_VALUE_PROFILE.weights.sectorPosition}`);
    for (const tier of ['A', 'B', 'C', 'watchlist']) {
      expect(report).toContain(`- ${tier}: ${run.tiers[tier as RankTier]}`);
    }
  });

  it('известная метрика печатается со ссылкой и asOf, неизвестная — явным unknown', () => {
    const ranked = rankCandidate(candidateEval(), DEEP_VALUE_PROFILE);
    const report = renderRankingReport(runOf([ranked]));

    expect(report).toContain('pRev=12.5 x ([источник](https://defillama.com/protocol/aave-v3), asOf 2026-08-27T00:00:00.000Z)');
    expect(report).toContain('unlock12mPct=unknown');
  });

  it('watchlist-кандидат попадает в отдельный раздел с причиной хард-фильтра', () => {
    const watchlisted = candidateEval({
      coingeckoId: 'neg',
      ticker: 'NEG',
      tokenomics: block('tokenomics', 40, {}, { hardFilterFail: true }),
    });
    const ranked = rankCandidate(watchlisted, DEEP_VALUE_PROFILE);
    const report = renderRankingReport(runOf([ranked]));

    expect(ranked.rankTier).toBe('watchlist');
    expect(report).toContain('## Watchlist (хард-фильтр)');
    expect(report).toContain('NEG');
    expect(report).toMatch(/NEG[\s\S]*отрицательный NHY/);
  });

  it('пустой watchlist называет это явно, а не молчит', () => {
    const ranked = rankCandidate(candidateEval(), DEEP_VALUE_PROFILE);
    const report = renderRankingReport(runOf([ranked]));

    expect(report).toContain('Нет кандидатов с хард-фильтром в этом прогоне.');
  });

  it('notEvaluated виден в отчёте с причиной и заменяющими фактами', () => {
    const ranked = rankCandidate(candidateEval(), DEEP_VALUE_PROFILE);
    const report = renderRankingReport(runOf([ranked]));

    expect(report).toContain('## Не оценивается кодом');
    expect(report).toContain('mechanism');
    expect(report).toContain('holdersRevenue12mUsd');
  });

  it('два запуска с разным runId дают разные, но каждый раз одинаковые для себя тексты', () => {
    const ranked = rankCandidate(candidateEval(), DEEP_VALUE_PROFILE);
    const run1 = runOf([ranked], { runId: 'rank_a' });
    const run2 = runOf([ranked], { runId: 'rank_b' });

    expect(renderRankingReport(run1)).toBe(renderRankingReport(run1));
    expect(renderRankingReport(run1)).not.toBe(renderRankingReport(run2));
  });
});
