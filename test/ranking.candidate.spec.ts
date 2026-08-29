import { DEFAULT_PROFILE } from '../src/config/profiles';
import { NOT_EVALUATED } from '../src/core/evaluation/evaluation.constants';
import type { CandidateEvaluation, EvaluationBlock, EvaluationComponentName } from '../src/core/evaluation/evaluation.types';
import { rankCandidate } from '../src/core/ranking/ranking.candidate';

function block(
  component: EvaluationComponentName,
  score: number | null,
  dataQuality = 1,
  verdict: Record<string, unknown> = {},
  missing: string[] = [],
): EvaluationBlock {
  return { component, title: component, verdict, score, metrics: {}, dataQuality, missing, notes: '' };
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

describe('rankCandidate(): тир и композит одного кандидата шага 15.1', () => {
  it('один известный компонент — composite null, тир C, не A и не ноль по умолчанию', () => {
    const candidate = candidateEval({
      tokenomics: block('tokenomics', 60, 1, { hardFilterFail: false }),
      valuation: block('valuation', null, 1, { passed: true }),
      sectorPosition: block('sectorPosition', null, 1, {}),
    });

    const ranked = rankCandidate(candidate, DEFAULT_PROFILE);

    expect(ranked.composite).toBeNull();
    expect(ranked.compositeBase).toBeNull();
    expect(ranked.rankTier).toBe('C');
    expect(ranked.hardFilters).toEqual([]);
  });

  it('два компонента с composite ≥ a и dataQuality ≥ 0.7 — тир A', () => {
    const candidate = candidateEval({
      tokenomics: block('tokenomics', 80, 1, {}),
      valuation: block('valuation', 60, 1, { passed: true }),
      sectorPosition: block('sectorPosition', null, 1, {}),
    });

    const ranked = rankCandidate(candidate, DEFAULT_PROFILE);

    expect(ranked.compositeBase).toBe(70);
    expect(ranked.composite).toBe(70);
    expect(ranked.dataQuality).toBe(1);
    expect(ranked.rankTier).toBe('A');
  });

  it('три компонента с composite между b и a — тир B', () => {
    const candidate = candidateEval({
      tokenomics: block('tokenomics', 80, 1, {}),
      valuation: block('valuation', 60, 1, { passed: true }),
      sectorPosition: block('sectorPosition', 40, 1, {}),
    });

    const ranked = rankCandidate(candidate, DEFAULT_PROFILE);

    // Все три веса известны и в сумме дают 1: (80*0.35 + 60*0.35 + 40*0.30) / 1 = 61.
    expect(ranked.composite).toBe(61);
    expect(ranked.rankTier).toBe('B');
  });

  it('composite ниже b без хард-фильтра — тир C', () => {
    const candidate = candidateEval({
      tokenomics: block('tokenomics', 30, 1, {}),
      valuation: block('valuation', 20, 1, { passed: true }),
      sectorPosition: block('sectorPosition', 10, 1, {}),
    });

    const ranked = rankCandidate(candidate, DEFAULT_PROFILE);

    expect(ranked.composite).toBeCloseTo(20.5, 2);
    expect(ranked.rankTier).toBe('C');
  });

  it('НЕГАТИВНЫЙ: высокий composite, но dataQuality ниже minDataQuality — тир C, не A', () => {
    const candidate = candidateEval({
      tokenomics: block('tokenomics', 90, 0.3, {}),
      valuation: block('valuation', 90, 0.3, { passed: true }),
      sectorPosition: block('sectorPosition', null, 1, {}),
    });

    const ranked = rankCandidate(candidate, DEFAULT_PROFILE);

    expect(ranked.composite).toBe(90);
    expect(ranked.dataQuality).toBeLessThan(DEFAULT_PROFILE.tierCuts.minDataQuality);
    expect(ranked.rankTier).toBe('C');
  });

  it('провал абсолютных проверок valuation — watchlist, но composite не обнуляется', () => {
    const candidate = candidateEval({
      valuation: block('valuation', null, 1, { passed: false, failedChecks: ['Выручка не измерена'] }),
      tokenomics: block('tokenomics', 70, 1, { hardFilterFail: false }),
      sectorPosition: block('sectorPosition', 80, 1, {}),
    });

    const ranked = rankCandidate(candidate, DEFAULT_PROFILE);

    expect(ranked.rankTier).toBe('watchlist');
    expect(ranked.hardFilters).toEqual([{ id: 'valuation_failed', reason: 'Выручка не измерена' }]);
    expect(ranked.composite).not.toBeNull();
  });

  it('подтверждённый отрицательный NHY tokenomics — watchlist с фиксированной причиной', () => {
    const candidate = candidateEval({
      tokenomics: block('tokenomics', 40, 1, { hardFilterFail: true }),
    });

    const ranked = rankCandidate(candidate, DEFAULT_PROFILE);

    expect(ranked.rankTier).toBe('watchlist');
    expect(ranked.hardFilters).toEqual([
      { id: 'tokenomics_hard_filter', reason: expect.stringContaining('отрицательный NHY') },
    ]);
  });

  it('оба хард-фильтра сразу — оба видны, риск-флаг хард-фильтром не является', () => {
    const candidate = candidateEval({
      valuation: block('valuation', 60, 1, { passed: false }),
      tokenomics: block('tokenomics', 70, 1, { hardFilterFail: true }),
      riskFlags: [
        {
          id: 'high_turnover',
          label: 'test',
          value: 90,
          penalty: 10,
          metric: { value: 90, unit: '%', sourceUrl: 'https://x', asOf: '2026-01-01T00:00:00.000Z' },
        },
      ],
      flagPenalty: 10,
    });

    const ranked = rankCandidate(candidate, DEFAULT_PROFILE);

    expect(ranked.hardFilters.map((item) => item.id)).toEqual(['valuation_failed', 'tokenomics_hard_filter']);
    expect(ranked.hardFilters[0].reason).toBe('Провалена одна из абсолютных проверок valuation.');
  });

  it('НЕГАТИВНЫЙ: flagPenalty не опускает composite ниже нуля', () => {
    const candidate = candidateEval({
      tokenomics: block('tokenomics', 20, 1, {}),
      valuation: block('valuation', 10, 1, { passed: true }),
      sectorPosition: block('sectorPosition', null, 1, {}),
      flagPenalty: 20,
    });

    const ranked = rankCandidate(candidate, DEFAULT_PROFILE);

    expect(ranked.compositeBase).toBe(15);
    expect(ranked.composite).toBe(0);
    expect(ranked.rankTier).toBe('C');
  });

  it('whatWouldChangeThis называет причину null-композита и недостающие метрики', () => {
    const candidate = candidateEval({
      tokenomics: block('tokenomics', 60, 1, {}, ['unlock12mPct']),
      valuation: block('valuation', null, 1, { passed: true }, ['pRev', 'revenue12mUsd']),
      sectorPosition: block('sectorPosition', null, 1, {}),
    });

    const ranked = rankCandidate(candidate, DEFAULT_PROFILE);

    expect(ranked.whatWouldChangeThis.some((item) => item.includes('минимум 2'))).toBe(true);
    expect(ranked.whatWouldChangeThis.some((item) => item.includes('pRev'))).toBe(true);
  });

  it('notEvaluated из evaluation-карточки виден в ranking-карточке без изменений', () => {
    const candidate = candidateEval();
    const ranked = rankCandidate(candidate, DEFAULT_PROFILE);

    expect(ranked.evaluation.notEvaluated).toEqual(NOT_EVALUATED);
  });
});
