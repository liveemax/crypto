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
