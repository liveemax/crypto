import { resolveIdentity, revenueStateOf } from '../src/core/universe/comparison';
import type { SectorMapEntry } from '../src/config/sector-map';
import type { UniverseCandidate } from '../src/core/universe/universe.types';

const layer1: SectorMapEntry = {
  category: 'layer-1', group: 'layer-1', archetype: 'chain', rationale: 'тест',
};
const exchange: SectorMapEntry = {
  category: 'exchange-based-tokens', group: 'exchange-token', archetype: 'exchange',
  rationale: 'тест',
};
const depin: SectorMapEntry = {
  category: 'depin', group: 'depin', archetype: 'infrastructure', rationale: 'тест',
};
const nft: SectorMapEntry = {
  category: 'non-fungible-tokens-nft', group: 'nft', archetype: 'protocol', rationale: 'тест',
};

describe('Группа сравнения', () => {
  it('категория DeFiLlama сильнее карты CoinGecko', () => {
    expect(resolveIdentity('lending', [nft])).toEqual({
      comparisonGroup: 'lending', assetArchetype: 'protocol', source: 'llama',
    });
  });

  it('тематическая категория не забирает сеть', () => {
    // Litecoin в infrastructure и Bittensor в depin — тот самый баг.
    expect(resolveIdentity('chain', [depin, nft])).toEqual({
      comparisonGroup: 'chain', assetArchetype: 'chain', source: 'chain',
    });
  });

  it('сеть уточняется слоем, даже если тема стоит выше в карте', () => {
    expect(resolveIdentity('chain', [depin, layer1])).toEqual({
      comparisonGroup: 'layer-1', assetArchetype: 'chain', source: 'chain_refined',
    });
  });

  it('биржа со своей сетью остаётся биржей', () => {
    // KCS: денежная модель — выкуп биржи, а не комиссии блокспейса.
    expect(resolveIdentity('chain', [nft, exchange])).toEqual({
      comparisonGroup: 'exchange-token', assetArchetype: 'exchange', source: 'chain_refined',
    });
  });

  it('без категории DeFiLlama берёт первая категория карты', () => {
    expect(resolveIdentity(null, [depin, layer1])).toEqual({
      comparisonGroup: 'depin', assetArchetype: 'infrastructure', source: 'map',
    });
  });

  it('НЕГАТИВНЫЙ: нет ничего — группы нет, а не «other» как группа', () => {
    expect(resolveIdentity(null, [])).toEqual({
      comparisonGroup: null, assetArchetype: 'other', source: 'none',
    });
  });
});

function row(patch: Partial<UniverseCandidate>): UniverseCandidate {
  return {
    sourceHealthy: true, revenue12mUsd: null, matchedBy: 'gecko_id',
    assetArchetype: 'protocol', ...patch,
  } as UniverseCandidate;
}

describe('Состояние выручки', () => {
  it('измеренный ноль — не пробел', () => {
    expect(revenueStateOf(row({ revenue12mUsd: 0 }))).toBe('known_zero');
  });

  it('несклеенная монета отличается от протокола без адаптера', () => {
    expect(revenueStateOf(row({ matchedBy: 'none' }))).toBe('mapping_failed');
    expect(revenueStateOf(row({ matchedBy: 'gecko_id' }))).toBe('source_missing');
  });

  it('сеть без сводки — неприменимая модель, а не потеря данных', () => {
    expect(revenueStateOf(row({ assetArchetype: 'chain' }))).toBe('unsupported_business_model');
  });

  it('сломанный адаптер важнее любого числа', () => {
    expect(revenueStateOf(row({ sourceHealthy: false, revenue12mUsd: 100 }))).toBe('source_stale');
  });
});