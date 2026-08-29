import { DEFAULT_PROFILE } from '../src/config/profiles';
import { NOT_EVALUATED } from '../src/core/evaluation/evaluation.constants';
import type { CandidateEvaluation, EvaluationBlock, EvaluationComponentName } from '../src/core/evaluation/evaluation.types';
import { rankCandidate } from '../src/core/ranking/ranking.candidate';
import { rankingSummaryRow } from '../src/core/ranking/ranking.summary';

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
    sectorPosition: block('sectorPosition', 80, 0.5, {}, ['unlock12mPct']),
    notEvaluated: NOT_EVALUATED,
    riskFlags: [
      {
        id: 'high_turnover',
        label: 'Оборот 63.4% от капитализации за сутки',
        value: 63.4,
        penalty: 10,
        metric: { value: 63.4, unit: '%', sourceUrl: 'https://api.coingecko.com/x', asOf: '2026-08-27T00:00:00.000Z' },
      },
    ],
    flagPenalty: 10,
    riskMissing: [],
    ...overrides,
  };
}

describe('rankingSummaryRow(): лёгкая строка summary из полной карточки шага 15.2', () => {
  it('переносит идентичность, тир, баллы, dataQuality и композит без изменений', () => {
    const candidate = candidateEval();
    const ranked = rankCandidate(candidate, DEFAULT_PROFILE);
    const row = rankingSummaryRow(ranked);

    expect(row.coingeckoId).toBe('base');
    expect(row.ticker).toBe('BASE');
    expect(row.dataTier).toBe('yield');
    expect(row.rankTier).toBe(ranked.rankTier);
    expect(row.scores).toEqual({ valuation: 60, tokenomics: 70, sectorPosition: 80 });
    expect(row.dataQuality).toEqual({ valuation: 1, tokenomics: 1, sectorPosition: 0.5 });
    expect(row.composite).toEqual({
      compositeBase: ranked.compositeBase,
      composite: ranked.composite,
      componentsUsed: ranked.componentsUsed,
      weightSum: ranked.weightSum,
      compositeReason: ranked.compositeReason,
      dataQuality: ranked.dataQuality,
    });
  });

  it('короткий риск-флаг теряет value и metric provenance: они остаются только в full', () => {
    const candidate = candidateEval();
    const ranked = rankCandidate(candidate, DEFAULT_PROFILE);
    const row = rankingSummaryRow(ranked);

    expect(row.riskFlags).toEqual([{ id: 'high_turnover', label: candidate.riskFlags[0].label, penalty: 10 }]);
    expect(row.flagPenalty).toBe(10);
    expect((row.riskFlags[0] as unknown as { metric?: unknown }).metric).toBeUndefined();
  });

  it('missing собирается по всем трём компонентам и сортируется без дублей', () => {
    const candidate = candidateEval({
      valuation: block('valuation', 60, 1, {}, ['pFees']),
      sectorPosition: block('sectorPosition', 80, 1, {}, ['unlock12mPct', 'pFees']),
    });
    const ranked = rankCandidate(candidate, DEFAULT_PROFILE);
    const row = rankingSummaryRow(ranked);

    expect(row.missing).toEqual(['pFees', 'unlock12mPct']);
  });

  it('hardFilters и notEvaluated едут теми же объектами, что у полного кандидата', () => {
    const candidate = candidateEval({ tokenomics: block('tokenomics', 70, 1, { hardFilterFail: true }) });
    const ranked = rankCandidate(candidate, DEFAULT_PROFILE);
    const row = rankingSummaryRow(ranked);

    expect(row.hardFilters).toEqual(ranked.hardFilters);
    expect(row.hardFilters.some((item) => item.id === 'tokenomics_hard_filter')).toBe(true);
    expect(row.notEvaluated).toEqual(candidate.notEvaluated);
  });
});
