import type { AlphaConfig, AnalysisProfile } from './profile.types';

/** Имя фильтра: оно же виновник отсева в воронке. */
export type FilterName = 'screen' | 'alpha';

export interface ScreenFilterState {
  enabled: boolean;
  /** Идентификатор встроенного профиля; null — разовый, пришедший телом запроса. */
  profileId: string | null;
  /**
   * Полная конфигурация. Имени недостаточно: разовый профиль по имени не
   * восстанавливается, а встроенный может измениться между коммитами.
   */
  profile: AnalysisProfile | null;
}

export interface AlphaFilterState {
  enabled: boolean;
  profileId: string | null;
  config: AlphaConfig | null;
}

/**
 * Состояние всех фильтров. Alpha объявлена здесь, а не появится позже: формат
 * файла состояния не должен меняться на следующем шаге, иначе рестарт после
 * обновления читает несуществующую форму. До шага 06 она всегда выключена.
 */
export interface ActiveFilterState {
  screen: ScreenFilterState;
  alpha: AlphaFilterState;
}

/** Тело POST /universe/screen: включение с конфигурацией либо выключение. */
export interface ScreenSelectionRequest {
  enabled: boolean;
  profileId?: string;
  profile?: AnalysisProfile;
}

/** Тело POST /universe/alpha: включение с конфигурацией либо выключение. */
export interface AlphaSelectionRequest {
  enabled: boolean;
  profileId?: string;
  alpha?: AlphaConfig;
}