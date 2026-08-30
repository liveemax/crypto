import { resolveProfile } from '../../config/profiles';
import { RESEARCH_DISCLAIMER } from '../disclaimer';
import { round } from '../money';
import type { Metric } from '../types';
import { EVALUATION_COMPONENTS, type CandidateEvaluation, type EvaluationComponentName } from '../evaluation/evaluation.types';
import type { RankedCandidate, RankingRun, RankTier } from './ranking.types';

const TIER_ORDER: RankTier[] = ['A', 'B', 'C', 'watchlist'];
const COMPONENT_TITLE: Record<EvaluationComponentName, string> = {
  valuation: 'Valuation',
  tokenomics: 'Tokenomics',
  sectorPosition: 'Sector position',
};

/**
 * Строит воспроизводимый markdown-отчёт по уже сохранённому ranking run.
 * Чистая функция: тот же run всегда даёт тот же текст, ни сети, ни хранилища.
 */
export function renderRankingReport(run: RankingRun): string {
  const profile = resolveProfile(run.rankingProfileId);
  const lines: string[] = [];

  lines.push(`# Рейтинг ${run.runId}`);
  lines.push('');
  lines.push(`> ${RESEARCH_DISCLAIMER}`);
  lines.push('');

  lines.push('## Контекст');
  lines.push('');
  lines.push(`- universeVersion: \`${run.universeVersion}\``);
  lines.push(`- builtAt: \`${run.builtAt}\``);
  lines.push(`- createdAt: \`${run.createdAt}\``);
  lines.push(
    `- активные фильтры: screen=${run.activeFilters.screen.enabled}, ` +
      `alpha=${run.activeFilters.alpha.enabled}`,
  );
  lines.push(`- профиль: \`${run.rankingProfileId}\` — ${profile.title}`);
  lines.push(`- evaluationRunId: \`${run.evaluationRunId}\``);
  lines.push(`- evaluationRecomputed: ${run.evaluationRecomputed ? 'да' : 'нет'}`);
  lines.push(`- кандидатов: ${run.candidateCount}`);
  lines.push('');

  lines.push('## Версии формул');
  lines.push('');
  lines.push(`- businessScale: \`${run.formulaVersions.businessScale}\``);
  lines.push(`- valuation: \`${run.formulaVersions.valuation}\``);
  lines.push(`- ranking: \`${run.formulaVersions.ranking}\``);
  lines.push('');

  lines.push('## Веса композита');
  lines.push('');
  lines.push(`- tokenomics: ${profile.weights.tokenomics}`);
  lines.push(`- valuation: ${profile.weights.valuation}`);
  lines.push(`- sectorPosition: ${profile.weights.sectorPosition}`);
  lines.push('');

  lines.push('## Тиры');
  lines.push('');
  for (const tier of TIER_ORDER) lines.push(`- ${tier}: ${run.tiers[tier]}`);
  lines.push('');

  if (run.notEvaluated.length > 0) {
    lines.push('## Не оценивается кодом');
    lines.push('');
    for (const item of run.notEvaluated) {
      lines.push(
        `- **${item.id}** — ${item.why}. Вместо этого измеряется: ` +
          `${item.whatWeMeasureInstead.join(', ')}.`,
      );
    }
    lines.push('');
  }

  const watchlist = run.candidates.filter((item) => item.rankTier === 'watchlist');
  lines.push('## Watchlist (хард-фильтр)');
  lines.push('');
  if (watchlist.length === 0) {
    lines.push('Нет кандидатов с хард-фильтром в этом прогоне.');
  } else {
    for (const item of watchlist) {
      lines.push(
        `- **${item.evaluation.ticker}** (\`${item.evaluation.coingeckoId}\`) — ` +
          item.hardFilters.map((reason) => reason.reason).join('; '),
      );
    }
  }
  lines.push('');

  lines.push('## Карточки по тирам');
  lines.push('');
  for (const tier of TIER_ORDER) {
    const rows = run.candidates.filter((item) => item.rankTier === tier);
    if (rows.length === 0) continue;
    lines.push(`### Тир ${tier} (${rows.length})`);
    lines.push('');
    for (const item of rows) lines.push(...candidateCard(item));
  }

  lines.push('---');
  lines.push('');
  lines.push(`> ${RESEARCH_DISCLAIMER}`);
  lines.push('');

  return lines.join('\n');
}

function candidateCard(candidate: RankedCandidate): string[] {
  const item = candidate.evaluation;
  const lines: string[] = [];
  lines.push(`#### ${item.ticker} — ${item.name} (\`${item.coingeckoId}\`)`);
  lines.push('');
  lines.push(`- comparisonGroup: ${item.comparisonGroup ?? 'нет'}`);
  lines.push(`- dataTier: ${item.dataTier}`);
  lines.push(
    `- composite: ${fmt(candidate.composite)} (до штрафа: ${fmt(candidate.compositeBase)}, ` +
      `flagPenalty: ${item.flagPenalty}, dataQuality: ${candidate.dataQuality})`,
  );
  lines.push(
    `- componentsUsed: ${candidate.componentsUsed.join(', ') || 'нет'}; ` +
      `weightSum: ${candidate.weightSum}` +
      (candidate.compositeReason ? `; compositeReason: ${candidate.compositeReason}` : ''),
  );
  for (const name of EVALUATION_COMPONENTS) {
    const block = item[name];
    lines.push(
      `- ${COMPONENT_TITLE[name]}: score=${fmt(block.score)}, dataQuality=${block.dataQuality}, ` +
        `missing=[${block.missing.join(', ')}]`,
    );
  }
  if (item.riskFlags.length > 0) {
    lines.push(
      `- riskFlags: ${item.riskFlags.map((flag) => `${flag.id} (-${flag.penalty})`).join(', ')}`,
    );
  }
  if (candidate.hardFilters.length > 0) {
    lines.push(`- hardFilters: ${candidate.hardFilters.map((reason) => reason.reason).join('; ')}`);
  }
  lines.push(`- provenance: ${provenanceOf(item)}`);
  lines.push('');
  return lines;
}

/** Число без источника — не число: каждая метрика едет со ссылкой и датой либо явным unknown. */
function provenanceOf(item: CandidateEvaluation): string {
  const parts: string[] = [];
  for (const name of EVALUATION_COMPONENTS) {
    for (const [field, metric] of Object.entries(item[name].metrics)) {
      parts.push(`${field}=${metricLine(metric)}`);
    }
  }
  return parts.length > 0 ? parts.join('; ') : 'нет метрик';
}

function metricLine(metric: Metric): string {
  if (metric.value === null) return 'unknown';
  const unit = metric.unit ? ` ${metric.unit}` : '';
  return `${metric.value}${unit} ([источник](${metric.sourceUrl}), asOf ${metric.asOf})`;
}

function fmt(value: number | null): string {
  return value === null ? 'null' : String(round(value, 1));
}
