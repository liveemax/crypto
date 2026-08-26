import type { SectorMapEntry } from '../../config/sector-map';
import type { AssetArchetype, DataState } from './comparison.types';
import type { UniverseCandidate } from './universe.types';
/**
 * Группа сравнения или null. Отсутствующее поле считается пробелом намеренно:
 * `undefined === null` даёт false, и снимок старого формата тихо превращается
 * в стопроцентное покрытие. Зелёный гейт на непересобранной вселенной хуже красного.
 */
export function groupOf(candidate: Partial<UniverseCandidate>): string | null {
  const group = candidate.comparisonGroup;
  return typeof group === 'string' && group.length > 0 ? group : null;
}

export function archetypeOf(candidate: Partial<UniverseCandidate>): AssetArchetype {
  return candidate.assetArchetype ?? 'other';
}

/** Почему выручка такая, какая есть. Ноль с источником — измерение, а не пробел. */
export function revenueStateOf(candidate: UniverseCandidate): DataState {
  if (!candidate.sourceHealthy) return 'source_stale';
  if (candidate.revenue12mUsd !== null && candidate.revenue12mUsd !== undefined) {
    return candidate.revenue12mUsd > 0 ? 'available' : 'known_zero';
  }
  if (candidate.matchedBy === 'none') return 'mapping_failed';
  // Сеть платит валидаторам и майнерам, а не держателю: сводки комиссий здесь
  // не «потерялись», их и не должно быть. Свои метрики — шаг 06.2.
  if (archetypeOf(candidate) === 'chain') return 'unsupported_business_model';
  return 'source_missing';
}

/** Снимок собран до появления групп сравнения: числа покрытия по нему ложны. */
export function isLegacyCandidate(candidate: Partial<UniverseCandidate>): boolean {
  return candidate.comparisonGroup === undefined;
}

/** Откуда взялась группа сравнения. Едет в warnings сборки, а не в кандидата. */
export type IdentitySource = 'llama' | 'map' | 'chain_refined' | 'chain' | 'none';

/**
 * Уточнять 'chain' вправе только категория, описывающая денежную модель:
 * слой сети или биржа. Тематическая категория сеть не забирает — иначе Litecoin
 * оказывается в infrastructure, Bittensor в depin, а Gala в nft, и группы
 * приложений раздуваются сетями, которые там сравнивать не с чем.
 */
const CHAIN_REFINERS: readonly AssetArchetype[] = ['chain', 'exchange'];

/**
 * Категория DeFiLlama — способ зарабатывать, категория CoinGecko — маркетинговая
 * тема, поэтому вторая применяется только там, где первой нет. Исключение одно
 * и записано в CLAUDE.md: 'chain' это архетип, а не ниша.
 */
export function resolveIdentity(
  sector: string | null,
  entries: readonly SectorMapEntry[],
): { comparisonGroup: string | null; assetArchetype: AssetArchetype; source: IdentitySource } {
  if (sector !== null && sector !== 'chain') {
    return { comparisonGroup: sector, assetArchetype: 'protocol', source: 'llama' };
  }
  if (sector === 'chain') {
    const refiner = entries.find((entry) => CHAIN_REFINERS.includes(entry.archetype));
    if (refiner) {
      return {
        comparisonGroup: refiner.group,
        assetArchetype: refiner.archetype,
        source: 'chain_refined',
      };
    }
    return { comparisonGroup: 'chain', assetArchetype: 'chain', source: 'chain' };
  }
  const first = entries[0];
  if (first) {
    return { comparisonGroup: first.group, assetArchetype: first.archetype, source: 'map' };
  }
  return { comparisonGroup: null, assetArchetype: 'other', source: 'none' };
}

/** Проставляет группу, архетип и состояние выручки всей вселенной за один проход. */
export function applyComparisonIdentity(
  candidates: UniverseCandidate[],
  map: Map<string, SectorMapEntry[]>,
  warnings: string[],
): void {
  const counts: Record<IdentitySource, number> = {
    llama: 0, map: 0, chain_refined: 0, chain: 0, none: 0,
  };

  for (const candidate of candidates) {
    const entries = map.get(candidate.coingeckoId) ?? [];
    candidate.rawSectors = entries.map((entry) => entry.category);

    const identity = resolveIdentity(candidate.sector, entries);
    candidate.comparisonGroup = identity.comparisonGroup;
    candidate.assetArchetype = identity.assetArchetype;
    counts[identity.source] += 1;

    // После архетипа: состояние сети зависит от того, признали ли её сетью.
    candidate.revenueState = revenueStateOf(candidate);
  }

  warnings.push(
    `Группы сравнения: от DeFiLlama ${counts.llama}, от карты CoinGecko ${counts.map}, ` +
      `сетей уточнено ${counts.chain_refined}, осталось общим chain ${counts.chain}, ` +
      `без группы ${counts.none}`,
  );
}