import { add, pctOf, round } from '../money';
import type { AlphaConfig } from './profile.types';
import type { CandidateView, FunnelStage } from './universe.types';
import type {
  AlphaDataGap,
  AlphaDecision,
  AlphaSectorSummary,
  AlphaStatus,
  AlphaView,
  SectorPercentile,
} from './alpha.types';
import { groupOf } from './comparison';

const MAX_PEERS = 12;
const SCALE_AXES = ['tvlUsd', 'revenue12mUsd'] as const;

export interface AlphaOutcome {
  stage: FunnelStage;
  sectors: AlphaSectorSummary[];
  dataGaps: AlphaDataGap[];
  warnings: string[];
}

/** Позиция в нише без решения об отсеве: общий результат business scale. */
export type SectorPosition = Omit<AlphaView, 'decision' | 'decisionReason'>;

interface PositionedMember {
  candidate: CandidateView;
  position: SectorPosition;
}

/**
 * Единственный источник перцентилей, долей и мест business scale.
 * В расчёт входят только TVL и годовая выручка с проверяемым provenance.
 */
export function businessScalePositions(
  candidates: readonly CandidateView[],
  config: AlphaConfig,
): Map<string, SectorPosition> {
  const groups = new Map<string, CandidateView[]>();
  for (const candidate of candidates) {
    const group = groupOf(candidate);
    if (group === null) continue;
    const members = groups.get(group);
    if (members) members.push(candidate);
    else groups.set(group, [candidate]);
  }

  const result = new Map<string, SectorPosition>();
  for (const members of groups.values()) {
    const positioned = positionGroup(members, config);
    for (const row of positioned) result.set(row.candidate.coingeckoId, row.position);
  }
  return result;
}

/** Оставляет top-N сравнимых только в перенасыщенной нише. */
export function applyAlpha(candidates: CandidateView[], config: AlphaConfig): AlphaOutcome {
  const input = candidates.filter((candidate) => candidate.passed);
  const positions = businessScalePositions(input, config);
  const groups = new Map<string, CandidateView[]>();
  const withoutGroup: CandidateView[] = [];
  for (const candidate of input) {
    const group = groupOf(candidate);
    if (group === null) withoutGroup.push(candidate);
    else groups.set(group, [...(groups.get(group) ?? []), candidate]);
  }

  const sectors: AlphaSectorSummary[] = [];
  const dataGaps: AlphaDataGap[] = [];
  let dropped = 0;
  for (const [group, members] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const saturated = members.length > config.perSector;
    let kept = 0;
    const ranked = members.filter(
      (candidate) => positions.get(candidate.coingeckoId)?.businessScaleScore !== null,
    ).length;
    for (const candidate of members) {
      const position = positions.get(candidate.coingeckoId)!;
      const decision = decisionOf(saturated, position.rankInSector, config.perSector);
      const alphaStatus = statusOf(saturated, position.rankInSector, config.perSector);
      const view: AlphaView = {
        ...position,
        alphaStatus,
        alphaQualified: alphaStatus === 'sector_leader',
        decision,
        decisionReason: reasonOf(alphaStatus, group, members.length, position.rankInSector, ranked, config),
      };
      candidate.alpha = view;
      if (decision === 'alpha_outranked') {
        candidate.passed = false;
        candidate.tier = 'rejected';
        candidate.rejectedAt = decision;
        candidate.rejectReason = view.decisionReason;
        dropped += 1;
      } else {
        kept += 1;
        if (position.businessScaleScore === null) dataGaps.push(gapOf(candidate, view));
      }
    }
    sectors.push({ sector: group, size: members.length, saturated, kept, dropped: members.length - kept, ranked });
  }

  for (const candidate of withoutGroup) {
    const view = missingSectorPosition(candidate);
    candidate.alpha = view;
    dataGaps.push(gapOf(candidate, view));
  }
  if (withoutGroup.length > 0) {
    sectors.push({ sector: null, size: withoutGroup.length, saturated: false, kept: withoutGroup.length, dropped: 0, ranked: 0 });
  }

  const warnings = dataGaps.length === 0
    ? []
    : [`Без business scale: ${dataGaps.length}. Оставлены как data gap, а не объявлены аутсайдерами.`];
  return {
    stage: { filter: 'alpha', stage: 'alpha_top_n', label: `Не больше ${config.perSector} сравнимых участников в перенасыщенном секторе`, incoming: input.length, dropped, kept: input.length - dropped },
    sectors,
    dataGaps,
    warnings,
  };
}

function positionGroup(members: CandidateView[], config: AlphaConfig): PositionedMember[] {
  const verified = new Map<string, { tvlUsd: number | null; revenue12mUsd: number | null }>();
  for (const candidate of members) {
    verified.set(candidate.coingeckoId, {
      tvlUsd: valid(candidate.tvlUsd, candidate.tvlSource, candidate.marketAsOf, candidate.sourceHealthy),
      revenue12mUsd: valid(candidate.revenue12mUsd, candidate.revenueSource, candidate.marketAsOf, candidate.sourceHealthy),
    });
  }
  const tvls = members.flatMap((candidate) => nullableArray(verified.get(candidate.coingeckoId)!.tvlUsd));
  const revenues = members.flatMap((candidate) => nullableArray(verified.get(candidate.coingeckoId)!.revenue12mUsd));
  const tvlTotal = tvls.reduce(add, 0);
  const revenueTotal = revenues.reduce(add, 0);

  const rows = members.map((candidate) => {
    const values = verified.get(candidate.coingeckoId)!;
    const percentiles: SectorPercentile[] = [
      percentileRow('tvlUsd', values.tvlUsd, tvls, candidate.tvlSource, candidate.marketAsOf, config.minRankedValues),
      percentileRow('revenue12mUsd', values.revenue12mUsd, revenues, candidate.revenueSource, candidate.marketAsOf, config.minRankedValues),
    ];
    const complete = percentiles.every((axis) => axis.percentile !== null);
    const businessScaleScore = complete
      ? round((percentiles[0].percentile! + percentiles[1].percentile!) / 2, 2)
      : null;
    return {
      candidate,
      businessScaleScore,
      percentiles,
      tvlRank: values.tvlUsd === null ? null : rankOf(values.tvlUsd, tvls),
      revenueRank: values.revenue12mUsd === null ? null : rankOf(values.revenue12mUsd, revenues),
      tvlRanked: tvls.length,
      revenueRanked: revenues.length,
      tvlSharePct: values.tvlUsd !== null && tvlTotal > 0 ? round(pctOf(values.tvlUsd, tvlTotal), 2) : null,
      revenueSharePct: values.revenue12mUsd !== null && revenueTotal > 0 ? round(pctOf(values.revenue12mUsd, revenueTotal), 2) : null,
    };
  });

  const comparable = rows.filter((row) => row.businessScaleScore !== null);
  comparable.sort((left, right) =>
    right.businessScaleScore! - left.businessScaleScore! ||
    (verified.get(right.candidate.coingeckoId)!.revenue12mUsd! - verified.get(left.candidate.coingeckoId)!.revenue12mUsd!) ||
    (verified.get(right.candidate.coingeckoId)!.tvlUsd! - verified.get(left.candidate.coingeckoId)!.tvlUsd!) ||
    left.candidate.coingeckoId.localeCompare(right.candidate.coingeckoId),
  );
  const ranks = new Map(comparable.map((row, index) => [row.candidate.coingeckoId, index + 1]));
  const peers = members.map((member) => member.ticker).sort().slice(0, MAX_PEERS + 1);
  return rows.map((row) => ({
    candidate: row.candidate,
    position: {
      sectorSize: members.length,
      rankInSector: ranks.get(row.candidate.coingeckoId) ?? null,
      businessScaleScore: row.businessScaleScore,
      tvlRank: row.tvlRank,
      revenueRank: row.revenueRank,
      tvlRanked: row.tvlRanked,
      revenueRanked: row.revenueRanked,
      tvlSharePct: row.tvlSharePct,
      revenueSharePct: row.revenueSharePct,
      comparisonAvailable: row.businessScaleScore !== null,
      alphaQualified:
        members.length > config.perSector &&
        (ranks.get(row.candidate.coingeckoId) ?? Infinity) <= config.perSector,
      alphaStatus:
        row.businessScaleScore === null
          ? 'insufficient_data'
          : members.length <= config.perSector
            ? 'sector_not_saturated'
            : (ranks.get(row.candidate.coingeckoId) ?? Infinity) <= config.perSector
              ? 'sector_leader'
              : 'outranked',
      percentiles: row.percentiles,
      peers: peers.filter((ticker) => ticker !== row.candidate.ticker).slice(0, MAX_PEERS),
    },
  }));
}

function valid(value: number | null, sourceUrl: string | null, asOf: string | null, healthy: boolean): number | null {
  return value !== null && sourceUrl !== null && sourceUrl.trim() !== '' && asOf !== null && asOf.trim() !== '' && healthy ? value : null;
}

function nullableArray(value: number | null): number[] { return value === null ? [] : [value]; }

function percentileRow(field: typeof SCALE_AXES[number], value: number | null, values: number[], sourceUrl: string | null, asOf: string | null, minimum: number): SectorPercentile {
  return { field, direction: 'higher_better', value, percentile: value === null ? null : percentileOf(value, values, minimum), ranked: values.length, sourceUrl: value === null ? null : sourceUrl, asOf: value === null ? null : asOf };
}

function percentileOf(value: number, values: number[], minimum: number): number | null {
  if (values.length < minimum || values.length < 2) return null;
  const worse = values.filter((other) => other < value).length;
  const ties = values.filter((other) => other === value).length - 1;
  return round(pctOf(worse + ties * 0.5, values.length - 1), 2);
}

function rankOf(value: number, values: number[]): number { return [...values].sort((a, b) => b - a).findIndex((item) => item === value) + 1; }
function decisionOf(saturated: boolean, rank: number | null, perSector: number): AlphaDecision { return !saturated ? 'sector_not_saturated' : rank === null ? 'alpha_unrankable' : rank <= perSector ? 'kept_top_n' : 'alpha_outranked'; }
function statusOf(saturated: boolean, rank: number | null, perSector: number): AlphaStatus { return rank === null ? 'insufficient_data' : !saturated ? 'sector_not_saturated' : rank <= perSector ? 'sector_leader' : 'outranked'; }

function reasonOf(status: AlphaStatus, group: string, size: number, rank: number | null, ranked: number, config: AlphaConfig): string {
  if (status === 'sector_not_saturated') return `В секторе ${group} ${size} участников при пороге ${config.perSector}: отбирать не из чего`;
  if (status === 'insufficient_data') return 'Нужны подтверждённые TVL и revenue и минимум три значения по каждой оси. Это пробел данных, а не последнее место';
  if (status === 'sector_leader') return `Место ${rank} из ${ranked} сравнимых в секторе ${group}`;
  return `Место ${rank} из ${ranked} в секторе ${group}: в топ-${config.perSector} не попал`;
}

function missingSectorPosition(candidate: CandidateView): AlphaView {
  return { sectorSize: 0, rankInSector: null, businessScaleScore: null, tvlRank: null, revenueRank: null, tvlRanked: 0, revenueRanked: 0, tvlSharePct: null, revenueSharePct: null, comparisonAvailable: false, alphaQualified: false, alphaStatus: 'missing_sector', percentiles: [], decision: 'alpha_missing_sector', decisionReason: 'Группа сравнения не определена: это пробел данных, а не вердикт о токене', peers: [] };
}

function gapOf(candidate: CandidateView, view: AlphaView): AlphaDataGap {
  return { coingeckoId: candidate.coingeckoId, ticker: candidate.ticker, sector: candidate.sector, reason: view.alphaStatus === 'missing_sector' ? 'alpha_missing_sector' : 'alpha_unrankable', availableMetrics: view.percentiles.filter((axis) => axis.percentile !== null).map((axis) => axis.field), missingMetrics: view.percentiles.filter((axis) => axis.percentile === null).map((axis) => axis.field), note: view.decisionReason };
}
