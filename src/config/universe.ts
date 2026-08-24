export interface UniverseItem {
  ticker: string;
  name: string;
  sector: string;
  /** Слаг протокола на defillama.com — часть может быть неверна, проверяется на шаге 04. */
  defillama: string;
  /** Идентификатор монеты на coingecko.com. */
  coingecko: string;
}

export const UNIVERSE: UniverseItem[] = [
  { ticker: 'HYPE', name: 'Hyperliquid', sector: 'perps', defillama: 'hyperliquid', coingecko: 'hyperliquid' },
  { ticker: 'AAVE', name: 'Aave', sector: 'lending', defillama: 'aave', coingecko: 'aave' },
  { ticker: 'MORPHO', name: 'Morpho', sector: 'lending', defillama: 'morpho', coingecko: 'morpho' },
  { ticker: 'SKY', name: 'Sky', sector: 'stables', defillama: 'sky-lending', coingecko: 'sky' },
  { ticker: 'LINK', name: 'Chainlink', sector: 'infra', defillama: 'chainlink', coingecko: 'chainlink' },
  { ticker: 'PENDLE', name: 'Pendle', sector: 'yield', defillama: 'pendle', coingecko: 'pendle' },
  { ticker: 'LDO', name: 'Lido', sector: 'lst', defillama: 'lido', coingecko: 'lido-dao' },
  { ticker: 'JTO', name: 'Jito', sector: 'lst', defillama: 'jito', coingecko: 'jito-governance-token' },
  { ticker: 'SNX', name: 'Synthetix', sector: 'perps', defillama: 'synthetix', coingecko: 'havven' },
  { ticker: 'GMX', name: 'GMX', sector: 'perps', defillama: 'gmx', coingecko: 'gmx' },
  { ticker: 'AERO', name: 'Aerodrome', sector: 'dex', defillama: 'aerodrome', coingecko: 'aerodrome-finance' },
  { ticker: 'NEAR', name: 'Near', sector: 'l1', defillama: 'near', coingecko: 'near' },
  { ticker: 'STRK', name: 'Starknet', sector: 'l2', defillama: 'starknet', coingecko: 'starknet' },
];

/** Находит актив по тикеру без учёта регистра. */
export function findByTicker(ticker: string): UniverseItem | undefined {
  const normalizedTicker = ticker.trim().toUpperCase();
  return UNIVERSE.find((item) => item.ticker === normalizedTicker);
}

/** Возвращает уникальные секторы в алфавитном порядке. */
export function sectors(): string[] {
  return [...new Set(UNIVERSE.map((item) => item.sector))].sort();
}
