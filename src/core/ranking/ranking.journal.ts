import { add, div, round } from '../money';
import type { RankingRun } from './ranking.types';

/** Заголовок таблицы reports/journal.md, пишется один раз при создании файла. */
export const RANKING_JOURNAL_HEADER =
  '| date | universeVersion | screen | alpha | evaluationRunId | rankingRunId | tierA | tierB | avgComposite |\n' +
  '|---|---|---|---|---|---|---|---|---|';

/**
 * Одна строка журнала на run: дата, снимок, фильтры, оба runId, тиры A/B и
 * средний composite среди тех, у кого он не null. Чистая функция для теста.
 */
export function rankingJournalRow(run: RankingRun): string {
  const composites = run.candidates
    .map((candidate) => candidate.composite)
    .filter((value): value is number => value !== null);
  const avgComposite =
    composites.length === 0
      ? 'null'
      : String(round(div(composites.reduce((sum, value) => add(sum, value), 0), composites.length), 1));

  return (
    `| ${run.createdAt.slice(0, 10)} | ${run.universeVersion} | ` +
    `${run.activeFilters.screen.enabled} | ${run.activeFilters.alpha.enabled} | ` +
    `${run.evaluationRunId} | ${run.runId} | ${run.tiers.A} | ${run.tiers.B} | ${avgComposite} |`
  );
}
