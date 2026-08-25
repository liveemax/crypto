import { DISCOVERY } from '../../config/discovery';
import { add, div, mul, pctOf, round } from '../money';
import { passesRule } from './universe.filter';
import type { AlphaConfig, AnalysisProfile, NumericField } from './profile.types';
import type { Tier, UniverseCandidate } from './universe.types';
import type {
  AlphaReport,
  ManualDataCandidate,
  SectorLeader,
  SectorMember,
  SectorPercentile,
  SectorWithoutComparison,
} from './alpha.types';

/** Тиры без финансовых чисел: ранжировать их не по чему. */
const UNRANKABLE_TIERS: Tier[] = ['pool', 'rejected'];

/** Сколько имён показывать в предупреждении, чтобы оно осталось читаемым. */
const WARN_SAMPLE = 12;

export interface AlphaContext {
  universeVersion: string;
  builtAt: string;
  /** Реестры исключений: нужны, если в qualify попало правило kind: 'excluded'. */
  excluded: Set<string>;
}

interface ScoredMember {
  candidate: UniverseCandidate;
  percentiles: SectorPercentile[];
  revenueSharePct: number | null;
  sectorScore: number | null;
}

type QualifiedMember = ScoredMember & { sectorScore: number };

interface MetricColumn {
  values: number[];
  byId: Map<string, number | null>;
}

interface SectorPlace {
  sector: string;
  rankInSector: number;
  sectorSize: number;
  qualifiedInSector: number;
  peers: string[];
}

/**
 * Выделяет лидеров каждого сектора из состава, прошедшего отбор профиля.
 * Сети не касается, кандидатов не мутирует.
 */
export function buildAlpha(
  candidates: UniverseCandidate[],
  profile: AnalysisProfile,
  context: AlphaContext,
): AlphaReport {
  const alpha = profile.alpha;
  const warnings: string[] = [];

  // Предохранитель против профиля, который просит ранжировать тир без чисел:
  // молча исполнить такой профиль — значит выдать перцентили по пустоте.
  const skipped = alpha.includeTiers.filter((tier) => UNRANKABLE_TIERS.includes(tier));
  if (skipped.length > 0) {
    warnings.push(
      `Тиры ${skipped.join(', ')} исключены из ранжирования: финансовых данных нет, ` +
        'перцентили сектора считать не по чему',
    );
  }
  const rankableTiers = alpha.includeTiers.filter(
    (tier) => !UNRANKABLE_TIERS.includes(tier),
  );

  const passed = candidates.filter((item) => item.passed);
  const ranked = passed.filter((item) => rankableTiers.includes(item.tier));

  const sectors = new Map<string, UniverseCandidate[]>();
  const unknownSector: UniverseCandidate[] = [];
  for (const item of ranked) {
    if (item.sector === null) {
      unknownSector.push(item);
      continue;
    }
    const bucket = sectors.get(item.sector);
    if (bucket) bucket.push(item);
    else sectors.set(item.sector, [item]);
  }

  const leaders: SectorLeader[] = [];
  const withoutComparison: SectorWithoutComparison[] = [];
  const withoutLeaders: string[] = [];
  const outliers: string[] = [];
  let sectorsRanked = 0;

  const ordered = [...sectors.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );

  for (const [sector, members] of ordered) {
    if (members.length < alpha.minSectorSize) {
      withoutComparison.push({
        sector,
        reason: 'too_small',
        size: members.length,
        members: members.map(toMember),
        note:
          `Участников ${members.length} при пороге сравнения ${alpha.minSectorSize}. ` +
          'Лидер выборки из одного-двух — не лидер, а единственный участник',
      });
      continue;
    }

    sectorsRanked += 1;
    const scored = scoreSector(members, alpha, outliers);

    // Порядок обязателен: сначала абсолютный порог, потом относительное место.
    // Иначе «лидер сектора из двух убыточных» становится валидным выводом.
    const qualified = scored.filter(
      (row): row is QualifiedMember =>
        row.sectorScore !== null &&
        alpha.qualify.every((rule) => passesRule(rule, row.candidate, context.excluded)),
    );
    if (qualified.length === 0) {
      withoutLeaders.push(sector);
      continue;
    }

    qualified.sort(byScoreDesc);
    qualified.slice(0, alpha.perSector).forEach((row, index) => {
      leaders.push(
        toLeader(row, {
          sector,
          rankInSector: index + 1,
          sectorSize: members.length,
          qualifiedInSector: qualified.length,
          peers: members
            .filter((item) => item.coingeckoId !== row.candidate.coingeckoId)
            .map((item) => item.ticker)
            .sort((left, right) => left.localeCompare(right)),
        }),
      );
    });
  }

  if (unknownSector.length > 0) {
    withoutComparison.push({
      sector: null,
      reason: 'unknown_sector',
      size: unknownSector.length,
      members: unknownSector
        .map(toMember)
        .sort((left, right) => left.ticker.localeCompare(right.ticker)),
      note:
        'Сектор не определён: протокол не найден или у группы нет категории. ' +
        'Прямых конкурентов назвать нельзя, поэтому перцентили не считаются',
    });
  }

  if (withoutLeaders.length > 0) {
    warnings.push(
      `Секторов без лидеров: ${withoutLeaders.length}. Участники есть, абсолютный ` +
        `порог qualify не прошёл никто: ${sample(withoutLeaders)}`,
    );
  }
  if (outliers.length > 0) {
    warnings.push(
      `Выброс revenuePerTvlPct выше ${DISCOVERY.maxRevenuePerTvlPct}%: метрика не ` +
        'участвует в перцентилях сектора, само число в кандидате не тронуто — ' +
        `при малом TVL оно бывает настоящим. ${sample(outliers)}`,
    );
  }

  // Рабочая очередь для POST /manual/docs: по этим система слепа.
  const needsManualData = passed
    .filter((item) => item.tier === 'pool')
    .filter((item) =>
      alpha.manualCandidates.every((rule) => passesRule(rule, item, context.excluded)),
    )
    .sort((left, right) => (right.mcapCalcUsd ?? 0) - (left.mcapCalcUsd ?? 0))
    .map(toManual);

  return {
    universeVersion: context.universeVersion,
    builtAt: context.builtAt,
    profileId: profile.id,
    alpha,
    totals: {
      passed: passed.length,
      ranked: ranked.length,
      sectors: sectors.size,
      sectorsRanked,
      sectorsWithoutComparison: withoutComparison.length,
      sectorsWithoutLeaders: withoutLeaders.length,
      leaders: leaders.length,
      needsManualData: needsManualData.length,
    },
    leaders,
    sectorsWithoutComparison: withoutComparison,
    needsManualData,
    warnings,
  };
}

/** Считает перцентили внутри сектора: сравнение идёт только с прямыми конкурентами. */
function scoreSector(
  members: UniverseCandidate[],
  alpha: AlphaConfig,
  outliers: string[],
): ScoredMember[] {
  const columns = new Map<NumericField, MetricColumn>();
  for (const metric of alpha.rankBy) {
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

  // Знаменатель доли — сумма выручки сектора. Неизвестная выручка не превращается в ноль.
  const revenueTotal = members.reduce(
    (sum, item) => (item.revenue12mUsd === null ? sum : add(sum, item.revenue12mUsd)),
    0,
  );

  return members.map((candidate) => {
    const percentiles = alpha.rankBy.map((metric) => {
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
            : percentileOf(usable, values, metric.direction, alpha.minSectorSize),
        ranked: values.length,
      };
    });

    return {
      candidate,
      percentiles,
      revenueSharePct:
        revenueTotal > 0 && candidate.revenue12mUsd !== null
          ? round(pctOf(candidate.revenue12mUsd, revenueTotal), 2)
          : null,
      sectorScore: meanOf(percentiles),
    };
  });
}

/**
 * Число, годное для сравнения внутри сектора.
 * Выброс выручки к TVL не обнуляется — при малом TVL он бывает настоящим, — но и
 * верхнего перцентиля не получает: иначе лидерство сектора достаётся склейке
 * чужих комиссий (у Canton вышло 9647%).
 */
function metricValue(
  item: UniverseCandidate,
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

/**
 * Доля конкурентов, которых участник обошёл. Равные делят место пополам, поэтому
 * три одинаковых числа дают 50, а не случайный порядок. Чисел меньше порога
 * сравнения — перцентиля нет: деление двух известных на 0 и 100 не измерение.
 */
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
  let ties = -1; // сам участник тоже лежит в values
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

/** Среднее доступных перцентилей; ни одного доступного — балла нет. */
function meanOf(percentiles: SectorPercentile[]): number | null {
  const available = percentiles
    .map((item) => item.percentile)
    .filter((value): value is number => value !== null);
  if (available.length === 0) return null;
  const total = available.reduce((sum, value) => add(sum, value), 0);
  return round(div(total, available.length), 2);
}

/** Внутри сектора разница в доли балла — шум, поэтому порядок доопределён явно. */
function byScoreDesc(left: QualifiedMember, right: QualifiedMember): number {
  const byScore = right.sectorScore - left.sectorScore;
  if (byScore !== 0) return byScore;
  const byRevenue =
    (right.candidate.revenue12mUsd ?? 0) - (left.candidate.revenue12mUsd ?? 0);
  if (byRevenue !== 0) return byRevenue;
  return left.candidate.ticker.localeCompare(right.candidate.ticker);
}

function toLeader(row: QualifiedMember, place: SectorPlace): SectorLeader {
  const item = row.candidate;
  return {
    coingeckoId: item.coingeckoId,
    ticker: item.ticker,
    name: item.name,
    tier: item.tier,
    sector: place.sector,
    rankInSector: place.rankInSector,
    sectorSize: place.sectorSize,
    qualifiedInSector: place.qualifiedInSector,
    sectorScore: row.sectorScore,
    percentiles: row.percentiles,
    revenueSharePct: row.revenueSharePct,
    mcapCalcUsd: item.mcapCalcUsd,
    revenue12mUsd: item.revenue12mUsd,
    holdersRevenue12mUsd: item.holdersRevenue12mUsd,
    holderYieldPct: item.holderYieldPct,
    pRev: item.pRev,
    revenueSource: item.revenueSource,
    marketAsOf: item.marketAsOf,
    peers: place.peers,
  };
}

function toMember(item: UniverseCandidate): SectorMember {
  return {
    coingeckoId: item.coingeckoId,
    ticker: item.ticker,
    name: item.name,
    tier: item.tier,
  };
}

function toManual(item: UniverseCandidate): ManualDataCandidate {
  return {
    ...toMember(item),
    sector: item.sector,
    mcapCalcUsd: item.mcapCalcUsd,
    vol24hUsd: item.vol24hUsd,
    matchedBy: item.matchedBy,
    defillamaSlugs: item.defillamaSlugs,
    reason: manualReason(item),
  };
}

/** Чего именно не хватает: слага, выручки или объяснения нулю. */
function manualReason(item: UniverseCandidate): string {
  if (item.matchedBy === 'none') {
    return 'Протокол DeFiLlama не найден ни по gecko_id, ни по тикеру группы: ' +
      'нужен другой источник или документация проекта';
  }
  if (item.revenue12mUsd === null) {
    return (
      `Протокол найден (${item.defillamaSlugs.join(', ') || '—'}), но выручки за ` +
      '12 месяцев в сводках комиссий нет'
    );
  }
  return (
    `Выручка по источнику ${item.revenue12mUsd} USD: сравнивать по экономике нечего, ` +
    'нужна документация проекта'
  );
}

function sample(items: string[]): string {
  const head = items.slice(0, WARN_SAMPLE).join(', ');
  return items.length > WARN_SAMPLE
    ? `${head} и ещё ${items.length - WARN_SAMPLE}`
    : head;
}