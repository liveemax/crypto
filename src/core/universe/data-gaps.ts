import type { CandidateView } from './universe.types';
import type { DataGapItem, DataGapQuery, DataGapRow } from './data-gaps.types';

/** Состояния, при которых число есть. Всё остальное — задача для адаптера. */
const REVENUE_RESOLVED = new Set(['available', 'known_zero']);
const TOKENOMICS_RESOLVED = new Set(['available', 'known_zero']);

const REVENUE_FIX: Record<string, string> = {
  mapping_failed: 'Монета не склеена с протоколом DeFiLlama: нужен адаптер сопоставления по контракту',
  source_missing: 'Сводки комиссий DeFiLlama монету не знают: нужен второй источник выручки',
  source_stale: 'Адаптер DeFiLlama сломан, числа устарели: чинится на стороне источника',
  unsupported_business_model:
    'Сеть платит валидаторам и майнерам, а не держателю: нужны свои метрики сети',
};

const TOKENOMICS_FIX: Record<string, string> = {
  source_missing: 'Календаря у DeFiLlama нет: POST /manual/unlocks со ссылкой и датой закроет NHY',
  source_error: 'Документ календаря не отдался: повторить POST /universe/tokenomics?force=true',
  matched_unparsed: 'Документ найден, расписание не разобрано: нужен разбор формата источника',
  source_stale: 'Расписание отстало от факта: адаптер источника не обновлён',
};

/**
 * Полная типизированная очередь пробелов, отсортированная по капитализации.
 * Сортировка по деньгам, а не по алфавиту: десять процентов монет бывают
 * половиной капитализации, и чинить их надо первыми.
 */
export function collectDataGaps(
  candidates: readonly CandidateView[],
  query: DataGapQuery = {},
): DataGapRow[] {
  const passedOnly = query.passedOnly ?? true;
  const rows: DataGapRow[] = [];

  for (const candidate of candidates) {
    if (passedOnly && !candidate.passed) continue;

    const gaps: DataGapItem[] = [];

    if (!REVENUE_RESOLVED.has(candidate.revenueState)) {
      gaps.push({
        field: 'revenue',
        state: candidate.revenueState,
        note: 'Выручки нет ни числом, ни подтверждённым нулём: pRev и доходность держателя не считаются',
        fix: REVENUE_FIX[candidate.revenueState] ?? 'Источник выручки не определён',
      });
    }

    if (!TOKENOMICS_RESOLVED.has(candidate.tokenomicsState)) {
      gaps.push({
        field: 'tokenomics',
        state: candidate.tokenomicsState,
        note: 'Календарь разлоков не покрыт: unlock12mPct и NHY остаются null, а не нулём',
        fix: TOKENOMICS_FIX[candidate.tokenomicsState] ?? 'Состояние календаря не распознано',
      });
    }

    if (candidate.comparisonGroup === null) {
      gaps.push({
        field: 'comparisonGroup',
        state: 'source_missing',
        note: 'Прямых конкурентов назвать нельзя: перцентили и место в нише не считаются',
        fix: 'Добавить категорию в config/sector-map под ревью, а не собирать группу «по похожести»',
      });
    }

    if (gaps.length === 0) continue;
    if (query.field !== undefined && !gaps.some((gap) => gap.field === query.field)) continue;
    if (query.dataState !== undefined && !gaps.some((gap) => gap.state === query.dataState)) continue;
    if (query.assetArchetype !== undefined && candidate.assetArchetype !== query.assetArchetype) continue;
    if (query.comparisonGroup !== undefined && candidate.comparisonGroup !== query.comparisonGroup) continue;

    rows.push({
      coingeckoId: candidate.coingeckoId,
      ticker: candidate.ticker,
      name: candidate.name,
      mcapCalcUsd: candidate.mcapCalcUsd,
      assetArchetype: candidate.assetArchetype,
      comparisonGroup: candidate.comparisonGroup,
      sector: candidate.sector,
      matchedBy: candidate.matchedBy,
      passed: candidate.passed,
      gaps,
    });
  }

  // Неизвестная капитализация уходит в конец: null не должен притворяться нулём.
  return rows.sort((left, right) => (right.mcapCalcUsd ?? -1) - (left.mcapCalcUsd ?? -1));
}