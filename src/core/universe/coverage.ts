import { COVERAGE } from '../../config/coverage';
import { archetypeOf, groupOf, isLegacyCandidate, revenueStateOf } from './comparison';
import { add, pctOf, round } from '../money';
import type { ActiveFilterState } from './filter-state.types';
import type { UniverseCandidate } from './universe.types';
import type {
  CoverageBucket,
  CoverageGap,
  CoverageReport,
  SectorCoverage,
} from './coverage.types';

const WORST_LIMIT = 20;
const GROUPS_LIMIT = 25;

export interface CoverageContext {
  universeVersion: string;
  builtAt: string;
  activeFilters: ActiveFilterState;
}

/**
 * Покрытие входа альфы. Считает чистая функция: гейт обязан давать одно и то же
 * число в HTTP-ответе и в CI, а два независимых подсчёта разъедутся за шаг.
 */
export function buildCoverage(
  candidates: UniverseCandidate[],
  context: CoverageContext,
): CoverageReport {
  const total = candidates.length;
  const totalMcapUsd = sumMcap(candidates);
  const warnings: string[] = [];

  const legacy = candidates.filter(isLegacyCandidate).length;
  if (legacy > 0) {
    warnings.push(
      `СНИМОК СТАРОГО ФОРМАТА: у ${legacy} кандидатов нет поля comparisonGroup. ` +
        'Они посчитаны пробелом — иначе непересобранная вселенная показала бы ' +
        '100% покрытия. Пересоберите: POST /universe/refresh?force=true',
    );
  }

  const gaps = candidates.filter((item) => groupOf(item) === null);
  const gapMcap = sumMcap(gaps);
  const gapPct = share(gaps.length, total);
  const gapMcapPct = share(gapMcap, totalMcapUsd);

  const sector: SectorCoverage = {
    withGroup: total - gaps.length,
    withoutGroup: gaps.length,
    gapPct,
    gapMcapPct,
    maxGapPct: COVERAGE.maxSectorGapPct,
    maxGapMcapPct: COVERAGE.maxSectorGapMcapPct,
    // Оба порога обязательны: пройти по числу и провалить по деньгам — это провал.
    passed:
      gapPct <= COVERAGE.maxSectorGapPct && gapMcapPct <= COVERAGE.maxSectorGapMcapPct,
    worst: gaps
      .sort((left, right) => (right.mcapCalcUsd ?? 0) - (left.mcapCalcUsd ?? 0))
      .slice(0, WORST_LIMIT)
      .map(toGap),
  };

  if (!sector.passed) {
    warnings.push(
      `ГЕЙТ ПОКРЫТИЯ КРАСНЫЙ: без группы ${gapPct}% при пороге ` +
        `${COVERAGE.maxSectorGapPct}%, по капитализации ${gapMcapPct}% при пороге ` +
        `${COVERAGE.maxSectorGapMcapPct}%. Порог опускается, а не поднимается: ` +
        'либо категория в карту, либо честное фиксирование достигнутого',
    );
  }

  const byState = bucketize(
    candidates,
    (item) => item.revenueState ?? revenueStateOf(item),
    total,
    totalMcapUsd,
  );
  const unsupported = byState.find((item) => item.key === 'unsupported_business_model');
  if (unsupported && unsupported.count > 0) {
    warnings.push(
      `Сетей с неприменимой моделью выручки: ${unsupported.count} ` +
        `(${unsupported.mcapPct}% капитализации). Комиссии майнеров не являются ` +
        'доходом держателя — им нужны свои метрики, это шаг 06.2',
    );
  }

  const groups = new Map<string, number>();
  for (const item of candidates) {
    const group = groupOf(item);
    if (group === null) continue;
    groups.set(group, (groups.get(group) ?? 0) + 1);
  }

  return {
    universeVersion: context.universeVersion,
    builtAt: context.builtAt,
    activeFilters: context.activeFilters,
    total,
    totalMcapUsd,
    sector,
    revenue: { byState, gated: false },
    archetypes: bucketize(candidates, archetypeOf, total, totalMcapUsd),
    groups: [...groups.entries()]
      .map(([group, size]) => ({ group, size }))
      .sort((left, right) => right.size - left.size)
      .slice(0, GROUPS_LIMIT),
    warnings,
  };
}

function bucketize(
  candidates: UniverseCandidate[],
  keyOf: (item: UniverseCandidate) => string,
  total: number,
  totalMcap: number,
): CoverageBucket[] {
  const counts = new Map<string, UniverseCandidate[]>();
  for (const item of candidates) {
    const key = keyOf(item);
    const bucket = counts.get(key);
    if (bucket) bucket.push(item);
    else counts.set(key, [item]);
  }
  return [...counts.entries()]
    .map(([key, rows]) => {
      const mcapUsd = sumMcap(rows);
      return {
        key,
        count: rows.length,
        pct: share(rows.length, total),
        mcapUsd,
        mcapPct: share(mcapUsd, totalMcap),
      };
    })
    .sort((left, right) => right.count - left.count);
}

function toGap(item: UniverseCandidate): CoverageGap {
  return {
    coingeckoId: item.coingeckoId,
    ticker: item.ticker,
    mcapCalcUsd: item.mcapCalcUsd,
    sector: item.sector,
    matchedBy: item.matchedBy,
    revenueState: item.revenueState,
  };
}

/** Неизвестная капитализация не превращается в ноль: она просто не взвешивается. */
function sumMcap(candidates: UniverseCandidate[]): number {
  return candidates.reduce(
    (sum, item) => (item.mcapCalcUsd === null ? sum : add(sum, item.mcapCalcUsd)),
    0,
  );
}

function share(part: number, whole: number): number {
  return whole > 0 ? round(pctOf(part, whole), 2) : 0;
}