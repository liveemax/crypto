import type { SectorPosition } from '../universe/alpha';
import type { AlphaView, SectorPercentile } from '../universe/alpha.types';
import type { AlphaConfig, NumericField } from '../universe/profile.types';
import type { UniverseCandidate } from '../universe/universe.types';
import {
  CHEAPNESS_FIELDS,
  EFFICIENCY_FIELDS,
  ROLE_CUTS,
  SCALE_FIELDS,
  SUPPLY_FIELD,
  metricOf,
} from './evaluation.constants';
import { finishBlock } from './evaluation.block';
import type { EvaluationBlock } from './evaluation.types';

const TITLE = 'Положение среди прямых конкурентов';

const ROLE_LABELS: Record<string, string> = {
  leader: 'Лидер ниши: держит долю выручки и эффективен',
  challenger: 'Претендент: эффективность выше половины ниши',
  overvalued: 'Переоценён: дорог относительно ниши при малом масштабе',
  outsider: 'Аутсайдер: сравнение проиграно по обеим осям',
  supply_only: 'Сравнён только по предложению: экономика не измерена',
  unknown: 'Роль не определена: сравнивать не с кем или нечем',
};

/** Ставит кандидата на место в его нише. Состав выборки не меняет ни при каких условиях. */
export function evaluateSectorPosition(
  candidate: UniverseCandidate,
  position: SectorPosition | null,
  config: AlphaConfig,
  filterView: AlphaView | null,
  selectionApplied: boolean,
): EvaluationBlock {
  const percentiles = position?.percentiles ?? [];
  const ranked = percentiles.filter((item) => item.percentile !== null);
  const economicAxes = ranked.filter((item) => item.field !== SUPPLY_FIELD).length;

  const byField = new Map<NumericField, number | null>(
    percentiles.map((item: SectorPercentile) => [item.field, item.percentile]),
  );
  const efficiency = firstAvailable(byField, EFFICIENCY_FIELDS);
  const cheapness = firstAvailable(byField, CHEAPNESS_FIELDS);
  const scale = firstAvailable(byField, SCALE_FIELDS);
  const role = roleOf(position, economicAxes, efficiency, cheapness, scale);

  const metrics: Record<string, ReturnType<typeof metricOf>> = {};
  for (const item of config.rankBy) metrics[item.field] = metricOf(candidate, item.field);

  return finishBlock('sectorPosition', TITLE, {
    score: position?.businessScaleScore ?? null,
    verdict: {
      role,
      roleLabel: ROLE_LABELS[role],
      businessScaleScore: position?.businessScaleScore ?? null,
      rankInSector: position?.rankInSector ?? null,
      sectorSize: position?.sectorSize ?? null,
      tvlRank: position?.tvlRank ?? null,
      revenueRank: position?.revenueRank ?? null,
      tvlRanked: position?.tvlRanked ?? 0,
      revenueRanked: position?.revenueRanked ?? 0,
      tvlSharePct: position?.tvlSharePct ?? null,
      /** По скольким осям посчитано место. Место по семи осям и по одной — разные утверждения. */
      rankedOn: ranked.length,
      economicAxes,
      revenueSharePct: position?.revenueSharePct ?? null,
      comparisonAvailable: position?.comparisonAvailable ?? false,
      alphaQualified: position?.alphaQualified ?? false,
      alphaStatus: position?.alphaStatus ?? (candidate.comparisonGroup === null ? 'missing_sector' : 'insufficient_data'),
      comparisonGroup: candidate.comparisonGroup,
      /** true — альфа включена и сама режет эту нишу; на расчёт места это не влияет. */
      selectionApplied,
      filterDecision: filterView?.decision ?? null,
      filterRankInSector: filterView?.rankInSector ?? null,
      peers: position?.peers ?? [],
      percentiles,
      efficiencyPercentile: efficiency,
      cheapnessPercentile: cheapness,
      scalePercentile: scale,
      supplyPercentile: byField.get(SUPPLY_FIELD) ?? null,
    },
    metrics,
    notes: notesOf(candidate, position, ranked.length, economicAxes),
  });
}

function roleOf(
  position: SectorPosition | null,
  economicAxes: number,
  efficiency: number | null,
  cheapness: number | null,
  scale: number | null,
): string {
  if (position === null || position.businessScaleScore === null) return 'unknown';
  // Место есть, но экономику не измеряли: назвать его лидером или аутсайдером
  // значит выдать сравнение по предложению за сравнение бизнесов.
  if (economicAxes === 0) return 'supply_only';
  if (
    position.revenueSharePct !== null &&
    position.revenueSharePct >= ROLE_CUTS.leaderSharePct &&
    efficiency !== null &&
    efficiency >= ROLE_CUTS.leaderEfficiency
  ) {
    return 'leader';
  }
  if (
    cheapness !== null &&
    cheapness < ROLE_CUTS.cheapBelow &&
    scale !== null &&
    scale < ROLE_CUTS.scaleBelow
  ) {
    return 'overvalued';
  }
  if (efficiency !== null && efficiency >= ROLE_CUTS.challengerEfficiency) return 'challenger';
  return 'outsider';
}

function notesOf(
  candidate: UniverseCandidate,
  position: SectorPosition | null,
  rankedOn: number,
  economicAxes: number,
): string {
  if (candidate.comparisonGroup === null) {
    return 'Группа сравнения не определена: это пробел покрытия, а не последнее место. Токен остаётся в выборке.';
  }
  if (position === null || position.businessScaleScore === null) {
    return 'Ни одна ось не дала перцентиля: в нише меньше трёх известных значений. Это пробел в данных, а не проигранное сравнение.';
  }
  if (economicAxes === 0) {
    return (
      `Место ${position.rankInSector} из ${position.sectorSize} посчитано только по предложению: ` +
      'выручки, комиссий и TVL у этого токена не измерено. Сравнивать его с бизнесом ниши нельзя.'
    );
  }
  return `Место ${position.rankInSector} из ${position.sectorSize}, осей сравнения ${rankedOn}.`;
}

function firstAvailable(
  byField: Map<NumericField, number | null>,
  order: NumericField[],
): number | null {
  for (const field of order) {
    const value = byField.get(field);
    if (value !== undefined && value !== null) return value;
  }
  return null;
}
