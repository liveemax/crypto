/** Версия формулы композита, сохраняемая с каждым ranking run. */
export const RANKING_FORMULA_VERSION = 'ranking-composite-v1';

/**
 * Гейт композита: меньше двух известных компонентов или меньшая сумма их весов —
 * итог null, а не число из одного удачного компонента. Тот же порог 0.55 из
 * раздела «Формулы, которые нельзя менять» в CLAUDE.md.
 */
export const COMPOSITE_MIN_COMPONENTS = 2;
export const COMPOSITE_MIN_WEIGHT_SUM = 0.55;

/** Тир A требует не только composite ≥ a из профиля, но и это качество данных. */
export const RANK_TIER_A_MIN_DATA_QUALITY = 0.7;

/**
 * ШАГ 16.2: множители tokenomics и valuation. sectorPosition всегда ×1.00.
 * 5×5 = 25 сценариев, включая baseline 1.00×1.00.
 */
export const SENSITIVITY_WEIGHT_MULTIPLIERS = [0.7, 0.85, 1.0, 1.15, 1.3] as const;

/** Версия sensitivity-расчёта: те же компоненты, что и ranking-composite, другие веса. */
export const SENSITIVITY_FORMULA_VERSION = 'ranking-sensitivity-v1';

/**
 * Порог доли кандидатов, сменивших тир хотя бы в одном из 25 сценариев:
 * ≤10% — stable, >10% — sensitive. Именованная константа, а не профиль:
 * это диагностика формулы, а не гипотеза о вселенной.
 */
export const SENSITIVITY_STABLE_MAX_SHARE_PCT = 10;

/** Меньше этого числа кандидатов с composite — вывод недостаточно надёжен. */
export const SENSITIVITY_MIN_CANDIDATES_FOR_VERDICT = 20;
