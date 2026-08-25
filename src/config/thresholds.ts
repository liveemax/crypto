import { DEFAULT_PROFILE } from './profiles';

/** Пороги хард-фильтров скринера из воспроизводимого профиля по умолчанию. */
export const THRESHOLDS = DEFAULT_PROFILE.thresholds;

/** Веса композита из воспроизводимого профиля по умолчанию. */
export const WEIGHTS = DEFAULT_PROFILE.weights;

/** Метрика старше этого числа дней помечается устаревшей. */
export const MAX_STALE_DAYS = 45;
