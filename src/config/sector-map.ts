import type { AssetArchetype } from '../core/universe/comparison.types';

export interface SectorMapEntry {
  /** Идентификатор категории CoinGecko. Проверен составом, а не наличием в списке. */
  category: string;
  /** Группа сравнения. Несколько категорий могут вести в одну группу. */
  group: string;
  archetype: AssetArchetype;
  /** Зачем группа отдельно. Через месяц «почему oracle не infrastructure» не вспомнить. */
  rationale: string;
}

/**
 * Карта применяется ТОЛЬКО там, где категории DeFiLlama нет: она про
 * маркетинговую тему, а категория DeFiLlama — про способ зарабатывать.
 *
 * Порядок = приоритет. Монета состоит в десятке категорий, группу даёт первая
 * совпавшая. Порядок здесь: способ зарабатывать → технологический слой → тема.
 *
 * Числа в комментариях — прогон 25.08 по 297 пробелам: сколько монет каждая
 * категория закрыла СВЕРХ уже закрытых предыдущими. Категории с нулём в карту
 * не входят: они дублируют строку выше и создают иллюзию покрытия.
 */
export const SECTOR_MAP: readonly SectorMapEntry[] = [
  // Биржевые токены: 18 монет, 20.25 млрд — крупнейший пробел выборки.
  // Выручка биржи непроверяема, поэтому группа честно останется без метрик,
  // но сравнивать WBT с Litecoin перестанем.
  { category: 'exchange-based-tokens', group: 'exchange-token', archetype: 'exchange',
    rationale: 'Токен централизованной биржи: выручка вне блокчейна, burn ≠ revenue' },
  { category: 'centralized-exchange-token-cex', group: 'exchange-token', archetype: 'exchange',
    rationale: 'Тот же класс, вторая категория CoinGecko' },

  // Приватные сети: 4 + 11 монет, 14.75 млрд. Одна группа намеренно —
  // privacy-coins и privacy-blockchain это один денежный механизм.
  { category: 'privacy-coins', group: 'privacy', archetype: 'chain',
    rationale: 'Приватная сеть: комиссии есть, сводок DeFiLlama нет' },
  { category: 'privacy-blockchain', group: 'privacy', archetype: 'chain',
    rationale: 'Тот же механизм, вторая категория CoinGecko' },

  // Протоколы: сюда попадает только то, что DeFiLlama не опознала.
  { category: 'lending-borrowing', group: 'lending', archetype: 'protocol',
    rationale: 'Кредитный протокол' },
  { category: 'decentralized-derivatives', group: 'derivatives', archetype: 'protocol',
    rationale: 'Деривативы и перпы: комиссия с оборота, одна денежная модель' },
  { category: 'decentralized-perpetuals', group: 'derivatives', archetype: 'protocol',
    rationale: 'Тот же механизм, вторая категория CoinGecko' },
  { category: 'yield-farming', group: 'yield', archetype: 'protocol',
    rationale: 'Доходные стратегии поверх чужих пулов' },
  { category: 'oracle', group: 'oracle', archetype: 'infrastructure',
    rationale: 'Плата за данные, а не за блокспейс: с DEX не сравнивается' },
  { category: 'bridge-governance-tokens', group: 'bridge', archetype: 'infrastructure',
    rationale: 'Мост: комиссия за переток, TVL чужой' },
  { category: 'launchpad', group: 'launchpad', archetype: 'protocol',
    rationale: 'Разовая выручка с запусков: повторяемость низкая по определению' },

  // Продуктовые ниши.
  { category: 'non-fungible-tokens-nft', group: 'nft', archetype: 'protocol',
    rationale: 'NFT-проекты: 23 монеты, выручка редко бывает on-chain' },
  { category: 'gaming', group: 'gaming', archetype: 'protocol',
    rationale: 'Игры: выручка в продукте, а не в комиссиях сети' },
  { category: 'metaverse', group: 'metaverse', archetype: 'protocol',
    rationale: 'Виртуальные миры: та же природа выручки, что у игр, но иной цикл' },
  { category: 'socialfi', group: 'socialfi', archetype: 'protocol',
    rationale: 'Социальные приложения' },
  { category: 'payment-solutions', group: 'payments', archetype: 'protocol',
    rationale: 'Платежи: выручка с объёма, часто вне сети' },
  { category: 'real-world-assets-rwa', group: 'rwa', archetype: 'protocol',
    rationale: 'RWA как группа сравнения; в отсев не идёт — там живые бизнесы' },
  { category: 'depin', group: 'depin', archetype: 'infrastructure',
    rationale: 'Награды из эмиссии выручкой не являются: группа нужна отдельно' },
  { category: 'artificial-intelligence', group: 'ai', archetype: 'infrastructure',
    rationale: 'Крупнейшая группа покрытия (31): денежная модель у большинства неясна' },
  { category: 'infrastructure', group: 'infrastructure', archetype: 'infrastructure',
    rationale: 'Общий слой: последний рубеж перед null, ставится после узких тем' },

  // Слои. Ниже узких тем намеренно: «layer-1» описывает технологию, а не бизнес.
  { category: 'layer-0-l0', group: 'layer-0', archetype: 'chain',
    rationale: 'Сети сетей: экономика отличается от L1' },
  { category: 'layer-1', group: 'layer-1', archetype: 'chain',
    rationale: 'Базовый слой: комиссии и эмиссия, метрики придут в 06.2' },
  { category: 'layer-2', group: 'layer-2', archetype: 'chain',
    rationale: 'Роллап платит за DA родительской сети: маржа устроена иначе' },
  { category: 'smart-contract-platform', group: 'smart-contract-platform', archetype: 'chain',
    rationale: 'Не слит с layer-1 намеренно: проверить слияние нечем до 06.2' },
];

/**
 * Проверены и в карту НЕ включены — ни одной монеты сверх уже покрытых:
 * centralized-exchange-cex-product, decentralized-exchange,
 * liquid-staking-governance-tokens, liquid-restaking-governance-token,
 * yield-aggregator, prediction-markets, nftfi, gaming-platform, storage,
 * layer-3-l3, bitcoin-layer-2, zero-knowledge-zk, proof-of-work-pow,
 * proof-of-stake-pos, masternodes.
 * `nft-aggregator` существует в списке, но отдаёт пустой состав — как
 * tokenized-t-bills; наличие в /categories/list ничего не гарантирует.
 */
export const CHECKED_NO_COVERAGE = 15;