import { rankingJournalRow, RANKING_JOURNAL_HEADER } from '../src/core/ranking/ranking.journal';
import type { RankedCandidate, RankingRun } from '../src/core/ranking/ranking.types';
import type { ActiveFilterState } from '../src/core/universe/filter-state.types';

const ACTIVE_FILTERS: ActiveFilterState = {
  screen: { enabled: true, profileId: 'deep-value', profile: null },
  alpha: { enabled: false, profileId: null, config: null },
};

function candidateWith(composite: number | null): RankedCandidate {
  return {
    evaluation: {
      coingeckoId: 'x',
      ticker: 'X',
      name: 'X',
      comparisonGroup: null,
      dataTier: 'yield',
      valuation: { component: 'valuation', title: '', verdict: {}, score: null, metrics: {}, dataQuality: 1, missing: [], notes: '' },
      tokenomics: { component: 'tokenomics', title: '', verdict: {}, score: null, metrics: {}, dataQuality: 1, missing: [], notes: '' },
      sectorPosition: { component: 'sectorPosition', title: '', verdict: {}, score: null, metrics: {}, dataQuality: 1, missing: [], notes: '' },
      notEvaluated: [],
      riskFlags: [],
      flagPenalty: 0,
      riskMissing: [],
    },
    rankTier: composite === null ? 'C' : 'B',
    compositeBase: composite,
    composite,
    componentsUsed: [],
    weightSum: 0,
    compositeReason: null,
    dataQuality: 1,
    hardFilters: [],
    whatWouldChangeThis: [],
  };
}

function runOf(candidates: RankedCandidate[]): RankingRun {
  return {
    runId: 'rank_2026-08-30T09-00-00-000Z_deep-value',
    createdAt: '2026-08-30T09:00:00.000Z',
    universeVersion: '2026-08-29',
    builtAt: '2026-08-29T06:00:00.000Z',
    activeFilters: ACTIVE_FILTERS,
    rankingProfileId: 'deep-value',
    formulaVersions: { businessScale: 'business-scale-v1', valuation: 'sector-valuation-v1', ranking: 'ranking-composite-v1' },
    inputHashes: { perToken: 'a', comparative: 'b' },
    evaluationRunId: 'eval_2026-08-30T09-00-00-000Z_deep-value',
    evaluationRecomputed: false,
    candidateCount: candidates.length,
    tiers: { A: 0, B: candidates.filter((item) => item.rankTier === 'B').length, C: 0, watchlist: 0 },
    notEvaluated: [],
    candidates,
  };
}

describe('rankingJournalRow(): одна строка журнала на run', () => {
  it('называет дату, снимок, фильтры и оба runId', () => {
    const run = runOf([candidateWith(61.4), candidateWith(80)]);
    const row = rankingJournalRow(run);

    expect(row).toContain('| 2026-08-30 |');
    expect(row).toContain(run.universeVersion);
    expect(row).toContain('true');
    expect(row).toContain('false');
    expect(row).toContain(run.evaluationRunId);
    expect(row).toContain(run.runId);
  });

  it('средний composite считается только по не-null значениям', () => {
    const run = runOf([candidateWith(60), candidateWith(80), candidateWith(null)]);
    const row = rankingJournalRow(run);

    expect(row).toContain('| 70 |');
  });

  it('нет ни одного известного composite — avgComposite null, а не 0', () => {
    const run = runOf([candidateWith(null), candidateWith(null)]);
    const row = rankingJournalRow(run);

    expect(row).toContain('| null |');
  });

  it('заголовок — валидная markdown-таблица с тем же числом колонок, что и строка', () => {
    const headerColumns = RANKING_JOURNAL_HEADER.split('\n')[0].split('|').length;
    const rowColumns = rankingJournalRow(runOf([candidateWith(50)])).split('|').length;
    expect(rowColumns).toBe(headerColumns);
  });
});
