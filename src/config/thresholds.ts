/** Пороги хард-фильтров скринера. */
export const THRESHOLDS = {
  minMcapUsd: 50_000_000,
  minAnnualRevenueUsd: 1_000_000,
  /** Выше — окупаемость за пределами разумного. */
  maxPRev: 60,
} as const;

/** Веса композита. Проверяются тестом устойчивости на шаге 14. */
export const WEIGHTS = {
  valueCapture: 0.25,
  revenueQuality: 0.2,
  unlocks: 0.25,
  sectorPosition: 0.15,
  organic: 0.15,
} as const;

/** Метрика старше этого числа дней помечается устаревшей. */
export const MAX_STALE_DAYS = 45;
