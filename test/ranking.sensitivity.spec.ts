import { DEFAULT_PROFILE } from '../src/config/profiles';
import { NOT_EVALUATED } from '../src/core/evaluation/evaluation.constants';
import type { CandidateEvaluation, EvaluationBlock, EvaluationComponentName } from '../src/core/evaluation/evaluation.types';
import { rankCandidate } from '../src/core/ranking/ranking.candidate';
import {
  SENSITIVITY_MIN_CANDIDATES_FOR_VERDICT,
  SENSITIVITY_STABLE_MAX_SHARE_PCT,
  SENSITIVITY_WEIGHT_MULTIPLIERS,
} from '../src/core/ranking/ranking.constants';
import type { RankedCandidate } from '../src/core/ranking/ranking.types';
import { buildScenarios, sensitivityForCandidate, sensitivityReportOf } from '../src/core/ranking/sensitivity';
import type { AnalysisProfile } from '../src/core/universe/profile.types';

function block(
  component: EvaluationComponentName,
  score: number | null,
  dataQuality = 1,
  verdict: Record<string, unknown> = {},
): EvaluationBlock {
  return { component, title: component, verdict, score, metrics: {}, dataQuality, missing: [], notes: '' };
}

function candidateEval(overrides: Partial<CandidateEvaluation> = {}): CandidateEvaluation {
  return {
    coingeckoId: 'base',
    ticker: 'BASE',
    name: 'Base',
    comparisonGroup: 'dexs',
    dataTier: 'yield',
    valuation: block('valuation', 60, 1, { passed: true }),
    tokenomics: block('tokenomics', 70, 1, { hardFilterFail: false }),
    sectorPosition: block('sectorPosition', 80, 1, {}),
    notEvaluated: NOT_EVALUATED,
    riskFlags: [],
    flagPenalty: 0,
    riskMissing: [],
    ...overrides,
  };
}

function ranked(overrides: Partial<CandidateEvaluation> = {}, profile: AnalysisProfile = DEFAULT_PROFILE): RankedCandidate {
  return rankCandidate(candidateEval(overrides), profile);
}

describe('buildScenarios(): 25 нормированных сценариев шага 16.2', () => {
  it('строит ровно 25 сценариев, каждый суммой весов ровно 1', () => {
    const scenarios = buildScenarios(DEFAULT_PROFILE.weights);

    expect(scenarios).toHaveLength(SENSITIVITY_WEIGHT_MULTIPLIERS.length ** 2);
    for (const scenario of scenarios) {
      const sum = scenario.weights.tokenomics + scenario.weights.valuation + scenario.weights.sectorPosition;
      expect(sum).toBe(1);
    }
  });

  it('все 25 наборов весов уникальны', () => {
    const scenarios = buildScenarios(DEFAULT_PROFILE.weights);
    const unique = new Set(scenarios.map((item) => JSON.stringify(item.weights)));

    expect(unique.size).toBe(25);
  });

  it('baseline 1.00×1.00 воспроизводит исходные веса профиля без изменений', () => {
    const scenarios = buildScenarios(DEFAULT_PROFILE.weights);
    const baseline = scenarios.find(
      (item) => item.tokenomicsMultiplier === 1.0 && item.valuationMultiplier === 1.0,
    );

    expect(baseline).toBeDefined();
    expect(baseline?.weights).toEqual(DEFAULT_PROFILE.weights);
  });
});

describe('sensitivityForCandidate(): реакция одного кандидата на 25 сценариев', () => {
  it('baseline совпадает с сохранённым ranking в пределах правила округления', () => {
    const candidate = ranked({
      tokenomics: block('tokenomics', 80, 1, {}),
      valuation: block('valuation', 60, 1, { passed: true }),
      sectorPosition: block('sectorPosition', 40, 1, {}),
    });
    const scenarios = buildScenarios(DEFAULT_PROFILE.weights);

    const result = sensitivityForCandidate(candidate, scenarios, DEFAULT_PROFILE);

    expect(result.baselineComposite).toBe(candidate.composite);
    expect(result.baselineTier).toBe(candidate.rankTier);
  });

  it('НЕГАТИВНЫЙ: один известный компонент — composite null во всех сценариях, не 0', () => {
    const candidate = ranked({
      tokenomics: block('tokenomics', 80, 1, {}),
      valuation: block('valuation', null, 1, { passed: true }),
      sectorPosition: block('sectorPosition', null, 1, {}),
    });
    const scenarios = buildScenarios(DEFAULT_PROFILE.weights);

    const result = sensitivityForCandidate(candidate, scenarios, DEFAULT_PROFILE);

    expect(candidate.composite).toBeNull();
    expect(result.minComposite).toBeNull();
    expect(result.maxComposite).toBeNull();
    expect(result.tierChanges).toBe(0);
    expect(result.tiersReached).toEqual([candidate.rankTier]);
  });

  it('НЕГАТИВНЫЙ: watchlist по хард-фильтру не покидает тир ни в одном из 25 сценариев', () => {
    const candidate = ranked({
      tokenomics: block('tokenomics', 40, 1, { hardFilterFail: true }),
      valuation: block('valuation', 60, 1, { passed: true }),
      sectorPosition: block('sectorPosition', 80, 1, {}),
    });
    const scenarios = buildScenarios(DEFAULT_PROFILE.weights);

    const result = sensitivityForCandidate(candidate, scenarios, DEFAULT_PROFILE);

    expect(candidate.rankTier).toBe('watchlist');
    expect(result.tierChanges).toBe(0);
    expect(result.tiersReached).toEqual(['watchlist']);
  });

  it('три известных компонента — composite меняется вместе с весами сценария', () => {
    const candidate = ranked({
      tokenomics: block('tokenomics', 90, 1, {}),
      valuation: block('valuation', 10, 1, { passed: true }),
      sectorPosition: block('sectorPosition', 50, 1, {}),
    });
    const scenarios = buildScenarios(DEFAULT_PROFILE.weights);

    const result = sensitivityForCandidate(candidate, scenarios, DEFAULT_PROFILE);

    expect(result.minComposite).not.toBeNull();
    expect(result.maxComposite).not.toBeNull();
    expect(result.minComposite as number).toBeLessThan(result.maxComposite as number);
  });
});

describe('sensitivityReportOf(): summary, transition matrix и интерпретация', () => {
  function stableCandidate(ticker: string): RankedCandidate {
    // Все три компонента высокие и близкие — маленькая перевзвешка тир не меняет.
    return ranked(
      {
        coingeckoId: ticker.toLowerCase(),
        ticker,
        tokenomics: block('tokenomics', 82, 1, {}),
        valuation: block('valuation', 80, 1, { passed: true }),
        sectorPosition: block('sectorPosition', 78, 1, {}),
      },
      DEFAULT_PROFILE,
    );
  }

  it('меньше SENSITIVITY_MIN_CANDIDATES_FOR_VERDICT кандидатов с composite — insufficient_data', () => {
    const candidates = Array.from({ length: SENSITIVITY_MIN_CANDIDATES_FOR_VERDICT - 1 }, (_unused, index) =>
      stableCandidate(`T${index}`),
    );
    const scenarios = buildScenarios(DEFAULT_PROFILE.weights);

    const { summary } = sensitivityReportOf(candidates, scenarios, DEFAULT_PROFILE);

    expect(summary.candidatesWithComposite).toBeLessThan(SENSITIVITY_MIN_CANDIDATES_FOR_VERDICT);
    expect(summary.interpretation).toBe('insufficient_data');
  });

  it('doля смены тира не выше SENSITIVITY_STABLE_MAX_SHARE_PCT — stable', () => {
    const candidates = Array.from({ length: SENSITIVITY_MIN_CANDIDATES_FOR_VERDICT + 5 }, (_unused, index) =>
      stableCandidate(`T${index}`),
    );
    const scenarios = buildScenarios(DEFAULT_PROFILE.weights);

    const { summary } = sensitivityReportOf(candidates, scenarios, DEFAULT_PROFILE);

    expect(summary.candidatesWithComposite).toBeGreaterThanOrEqual(SENSITIVITY_MIN_CANDIDATES_FOR_VERDICT);
    expect(summary.tierChangedSharePct).toBeLessThanOrEqual(SENSITIVITY_STABLE_MAX_SHARE_PCT);
    expect(summary.interpretation).toBe('stable');
  });

  it('watchlist остаётся в своей строке transition matrix: вне диагонали watchlist нулей', () => {
    const watchlisted = ranked({
      coingeckoId: 'neg',
      ticker: 'NEG',
      tokenomics: block('tokenomics', 40, 1, { hardFilterFail: true }),
      valuation: block('valuation', 60, 1, { passed: true }),
      sectorPosition: block('sectorPosition', 80, 1, {}),
    });
    const scenarios = buildScenarios(DEFAULT_PROFILE.weights);

    const { summary } = sensitivityReportOf([watchlisted], scenarios, DEFAULT_PROFILE);

    expect(summary.transitionMatrix.watchlist.watchlist).toBe(scenarios.length);
    expect(summary.transitionMatrix.watchlist.A).toBe(0);
    expect(summary.transitionMatrix.watchlist.B).toBe(0);
    expect(summary.transitionMatrix.watchlist.C).toBe(0);
  });

  it('результат детерминирован: два вызова на одном вводе дают одинаковый summary', () => {
    const candidates = [stableCandidate('AAA'), stableCandidate('BBB')];
    const scenarios = buildScenarios(DEFAULT_PROFILE.weights);

    const first = sensitivityReportOf(candidates, scenarios, DEFAULT_PROFILE);
    const second = sensitivityReportOf(candidates, scenarios, DEFAULT_PROFILE);

    expect(first.summary).toEqual(second.summary);
    expect(first.results).toEqual(second.results);
  });
});
