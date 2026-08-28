import { DISCOVERY } from '../../config/discovery';
import { add, div, mul, pctOf, round } from '../money';
import type { AlphaConfig, NumericField } from './profile.types';
import type { CandidateView, FunnelStage } from './universe.types';
import type {
  AlphaDataGap,
  AlphaDecision,
  AlphaSectorSummary,
  AlphaView,
  SectorPercentile,
} from './alpha.types';
import { groupOf } from './comparison';

const MAX_PEERS = 12;
const WARN_SAMPLE = 12;

export interface AlphaOutcome {
  stage: FunnelStage;
  sectors: AlphaSectorSummary[];
  dataGaps: AlphaDataGap[];
  warnings: string[];
}

interface ScoredMember {
  candidate: CandidateView;
  percentiles: SectorPercentile[];
  revenueSharePct: number | null;
  sectorScore: number | null;
}

type RankedMember = ScoredMember & { sectorScore: number };

interface MetricColumn {
  values: number[];
  byId: Map<string, number | null>;
}

/**
 * Оставляет в перенасыщенном секторе не больше perSector участников.
 * Мутирует переданные копии кандидатов; снимок при этом не трогается.
 */
export function applyAlpha(
  candidates: CandidateView[],
  config: AlphaConfig,
): AlphaOutcome {
  const input = candidates.filter((item) => item.passed);
  const incoming = input.length;

  // Группирует comparisonGroup, а не сырая категория: 'chain' на 61 участника —
  // это архетип, а не ниша, и сравнивать внутри него нечего.
  const sectors = new Map<string, CandidateView[]>();
  const withoutSector: CandidateView[] = [];
  for (const item of input) {
    const group = groupOf(item);
    if (group === null) {
      withoutSector.push(item);
      continue;
    }
    const bucket = sectors.get(group);
    if (bucket) bucket.push(item);
    else sectors.set(group, [item]);
  }

  const summaries: AlphaSectorSummary[] = [];
  const dataGaps: AlphaDataGap[] = [];
  const outliers: string[] = [];
  const unrankable: string[] = [];
  let dropped = 0;

  const ordered = [...sectors.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );

  for (const [sector, members] of ordered) {
    const saturated = members.length > config.perSector;
    const scored = scoreSector(members, config, outliers);
    const peers = pickPeers(members);

    const ranked = scored.filter(
      (row): row is RankedMember => row.sectorScore !== null,
    );
    ranked.sort(byScoreDesc);
    const place = new Map<string, number>();
    ranked.forEach((row, index) => place.set(row.candidate.coingeckoId, index + 1));

    let kept = 0;
    for (const row of scored) {
      const rank = place.get(row.candidate.coingeckoId) ?? null;
      const decision = decisionOf(saturated, rank, config);
      const view: AlphaView = {
        sectorSize: members.length,
        rankInSector: rank,
        sectorScore: row.sectorScore,
        percentiles: row.percentiles,
        revenueSharePct: row.revenueSharePct,
        comparisonAvailable: row.sectorScore !== null,
        decision,
        decisionReason: reasonOf(decision, sector, members.length, rank, ranked.length, config),
        peers: peers.filter((ticker) => ticker !== row.candidate.ticker).slice(0, MAX_PEERS),
      };
      row.candidate.alpha = view;

      // Удаляется только проигравший конкуренцию. Убрать несравнимого значит
      // подставить «плохо» вместо «неизвестно» — это запрещено инвариантом.
      if (decision === 'alpha_outranked') {
        cut(row.candidate, view);
        dropped += 1;
      } else {
        kept += 1;
        if (decision === 'alpha_unrankable') {
          unrankable.push(row.candidate.ticker);
          dataGaps.push(gapOf(row.candidate, view));
        }
      }
    }

    summaries.push({
      sector,
      size: members.length,
      saturated,
      kept,
      dropped: members.length - kept,
      ranked: ranked.length,
    });
  }

  // Сектор неизвестен — прямых конкурентов назвать нельзя, а общий котёл из всех
  // «без сектора» сравнил бы биржевой токен с L1. Это пробел данных, а не вердикт.
  for (const item of withoutSector) {
    const view: AlphaView = {
      sectorSize: 0,
      rankInSector: null,
      sectorScore: null,
      percentiles: [],
      revenueSharePct: null,
      comparisonAvailable: false,
      decision: 'alpha_missing_sector',
      decisionReason:
        'Группа сравнения не определена: конкурентов назвать нельзя. Токен остаётся ' +
        'в выборке — незнание группы это пробел данных, а не вердикт о токене',
      peers: [],
    };
    item.alpha = view;
    dataGaps.push(gapOf(item, view));
  }
  if (withoutSector.length > 0) {
    summaries.push({
      sector: null,
      size: withoutSector.length,
      saturated: false,
      kept: withoutSector.length,
      dropped: 0,
      ranked: 0,
    });
  }

  const warnings: string[] = [];
  if (withoutSector.length > 0) {
    warnings.push(
      `Без группы сравнения: ${withoutSector.length}. Оставлены в выборке, ` +
        'перечислены в dataGaps: это пробел покрытия, а не результат сравнения',
    );
  }
  if (unrankable.length > 0) {
    warnings.push(
      `Оставлены без сравнения в перенасыщенной нише: ${unrankable.length}. ` +
        `Нужно ${config.minScoreMetrics} метрик из ${config.rankBy.length}, ` +
        `их меньше: ${sample(unrankable)}`,
    );
  }
  if (outliers.length > 0) {
    warnings.push(
      `Выброс revenuePerTvlPct выше ${DISCOVERY.maxRevenuePerTvlPct}%: метрика не ` +
        'участвует в перцентилях, само число не тронуто — при малом TVL оно бывает ' +
        `настоящим. ${sample(outliers)}`,
    );
  }

  return {
    stage: {
      filter: 'alpha',
      stage: 'alpha_top_n',
      label: `Не больше ${config.perSector} участников в перенасыщенном секторе`,
      incoming,
      dropped,
      kept: incoming - dropped,
    },
    sectors: summaries,
    dataGaps,
    warnings,
  };
}

function decisionOf(
  saturated: boolean,
  rank: number | null,
  config: AlphaConfig,
): AlphaDecision {
  // Ненасыщенный сектор не режется вовсе: единственный участник — свойство рынка,
  // а не приговор токену.
  if (!saturated) return 'sector_not_saturated';
  if (rank === null) return 'alpha_unrankable';
  return rank <= config.perSector ? 'kept_top_n' : 'alpha_outranked';
}

function reasonOf(
  decision: AlphaDecision,
  sector: string,
  size: number,
  rank: number | null,
  ranked: number,
  config: AlphaConfig,
): string {
  switch (decision) {
    case 'sector_not_saturated':
      return `В секторе ${sector} ${size} участников при пороге ${config.perSector}: отбирать не из чего`;
    case 'kept_top_n':
      return `Место ${rank} из ${ranked} сравнимых в секторе ${sector}`;
    case 'alpha_outranked':
      return `Место ${rank} из ${ranked} в секторе ${sector}: в топ-${config.perSector} не попал`;
    case 'alpha_unrankable':
      return (
        `Остаётся без сравнения: известных метрик меньше ${config.minScoreMetrics} ` +
        `из ${config.rankBy.length}. Это пробел в данных, а не последнее место`
      );
    default:
      return 'Группа сравнения не определена';
  }
}

/** Отсев альфой: причина едет в строку кандидата, а не теряется в сводке. */
function cut(candidate: CandidateView, view: AlphaView): void {
  candidate.passed = false;
  candidate.tier = 'rejected';
  candidate.rejectedAt = view.decision;
  candidate.rejectReason = view.decisionReason;
}

function gapOf(candidate: CandidateView, view: AlphaView): AlphaDataGap {
  const available = view.percentiles
    .filter((item) => item.percentile !== null)
    .map((item) => item.field);
  const missing = view.percentiles
    .filter((item) => item.percentile === null)
    .map((item) => item.field);
  return {
    coingeckoId: candidate.coingeckoId,
    ticker: candidate.ticker,
    sector: candidate.sector,
    reason: view.decision === 'alpha_missing_sector' ? 'alpha_missing_sector' : 'alpha_unrankable',
    availableMetrics: available,
    missingMetrics: missing,
    note: view.decisionReason,
  };
}

/** Позиция в нише без решения об отсеве: то же, что AlphaView, минус вердикт. */
export type SectorPosition = Omit<AlphaView, 'decision' | 'decisionReason'>;

/**
 * Перцентили и место в нише по произвольному входу, никого не отсекая.
 * Оценка обязана считать позицию и при выключенной альфе, а вторая реализация
 * одной формулы разъедется за шаг и разъедется тихо.
 */
export function sectorPositions(
  candidates: readonly CandidateView[],
  config: AlphaConfig,
  outliers: string[] = [],
): Map<string, SectorPosition> {
  const sectors = new Map<string, CandidateView[]>();
  for (const item of candidates) {
    const group = groupOf(item);
    if (group === null) continue;
    const bucket = sectors.get(group);
    if (bucket) bucket.push(item);
    else sectors.set(group, [item]);
  }

  const positions = new Map<string, SectorPosition>();
  for (const members of sectors.values()) {
    const scored = scoreSector(members, config, outliers);
    const peers = pickPeers(members);
    const ranked = scored.filter((row): row is RankedMember => row.sectorScore !== null);
    ranked.sort(byScoreDesc);
    const place = new Map<string, number>();
    ranked.forEach((row, index) => place.set(row.candidate.coingeckoId, index + 1));

    for (const row of scored) {
      positions.set(row.candidate.coingeckoId, {
        sectorSize: members.length,
        rankInSector: place.get(row.candidate.coingeckoId) ?? null,
        sectorScore: row.sectorScore,
        percentiles: row.percentiles,
        revenueSharePct: row.revenueSharePct,
        comparisonAvailable: row.sectorScore !== null,
        peers: peers.filter((ticker) => ticker !== row.candidate.ticker),
      });
    }
  }
  return positions;
}

/** Считает перцентили внутри сектора: сравнение идёт только с прямыми конкурентами. */
function scoreSector(
  members: CandidateView[],
  config: AlphaConfig,
  outliers: string[],
): ScoredMember[] {
  const columns = new Map<NumericField, MetricColumn>();
  for (const metric of config.rankBy) {
    if (columns.has(metric.field)) continue;
    const byId = new Map<string, number | null>();
    const values: number[] = [];
    for (const item of members) {
      const value = metricValue(item, metric.field, outliers);
      byId.set(item.coingeckoId, value);
      if (value !== null) values.push(value);
    }
    columns.set(metric.field, { values, byId });
  }

  // Неизвестная выручка не превращается в ноль и не раздувает чужую долю.
  const revenueTotal = members.reduce(
    (sum, item) => (item.revenue12mUsd === null ? sum : add(sum, item.revenue12mUsd)),
    0,
  );

  return members.map((candidate) => {
    const percentiles = config.rankBy.map((metric) => {
      const column = columns.get(metric.field);
      const values = column?.values ?? [];
      const usable = column?.byId.get(candidate.coingeckoId) ?? null;
      return {
        field: metric.field,
        direction: metric.direction,
        value: candidate[metric.field],
        percentile:
          usable === null
            ? null
            : percentileOf(usable, values, metric.direction, config.minRankedValues),
        ranked: values.length,
      };
    });

    const available = percentiles.filter((item) => item.percentile !== null).length;
    return {
      candidate,
      percentiles,
      revenueSharePct:
        revenueTotal > 0 && candidate.revenue12mUsd !== null
          ? round(pctOf(candidate.revenue12mUsd, revenueTotal), 2)
          : null,
      sectorScore: available >= config.minScoreMetrics ? meanOf(percentiles) : null,
    };
  });
}

/**
 * Число, годное для сравнения. Выброс выручки к TVL не стирается — при малом TVL
 * он бывает настоящим, — но верхнего перцентиля не получает: иначе место в нише
 * достаётся ошибке склейки (у Canton вышло 9647%).
 */
function metricValue(
  item: CandidateView,
  field: NumericField,
  outliers: string[],
): number | null {
  const value = item[field];
  if (value === null) return null;
  if (field === 'revenuePerTvlPct' && value > DISCOVERY.maxRevenuePerTvlPct) {
    outliers.push(`${item.ticker} ${Math.round(value)}%`);
    return null;
  }
  return value;
}

/** Равные делят место пополам: три одинаковых числа дают 50, а не случайный порядок. */
function percentileOf(
  value: number,
  values: number[],
  direction: 'higher_better' | 'lower_better',
  minRanked: number,
): number | null {
  if (values.length < minRanked) return null;
  const others = values.length - 1;
  if (others <= 0) return null;

  let worse = 0;
  let ties = -1;
  for (const other of values) {
    if (other === value) {
      ties += 1;
      continue;
    }
    const isWorse = direction === 'higher_better' ? other < value : other > value;
    if (isWorse) worse += 1;
  }
  return round(pctOf(add(worse, mul(ties, 0.5)), others), 2);
}

function meanOf(percentiles: SectorPercentile[]): number | null {
  const available = percentiles
    .map((item) => item.percentile)
    .filter((value): value is number => value !== null);
  if (available.length === 0) return null;
  const total = available.reduce((sum, value) => add(sum, value), 0);
  return round(div(total, available.length), 2);
}

/** sectorScore DESC, затем выручка DESC с неизвестной в конце, затем тикер ASC. */
function byScoreDesc(left: RankedMember, right: RankedMember): number {
  const byScore = right.sectorScore - left.sectorScore;
  if (byScore !== 0) return byScore;
  const leftRevenue = left.candidate.revenue12mUsd;
  const rightRevenue = right.candidate.revenue12mUsd;
  if (leftRevenue !== rightRevenue) {
    if (leftRevenue === null) return 1;
    if (rightRevenue === null) return -1;
    return rightRevenue - leftRevenue;
  }
  return left.candidate.ticker.localeCompare(right.candidate.ticker);
}

function pickPeers(members: CandidateView[]): string[] {
  return members
    .map((item) => item.ticker)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_PEERS + 1);
}

function sample(items: string[]): string {
  const head = items.slice(0, WARN_SAMPLE).join(', ');
  return items.length > WARN_SAMPLE ? `${head} и ещё ${items.length - WARN_SAMPLE}` : head;
}