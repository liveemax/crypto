import { Injectable, Logger } from '@nestjs/common';
import { getProfile } from '../../config/profiles';
import { StoreService } from '../store/store.service';
import type { ActiveFilterState } from './filter-state.types';
import { parseAlphaConfig, parseAnalysisProfile } from './profile.schema';

const STATE_NAME = 'active-filters';

/** Состояние без единого фильтра: чистая вселенная фактов. */
export function emptyFilterState(): ActiveFilterState {
  return {
    screen: { enabled: false, profileId: null, profile: null },
    alpha: { enabled: false, profileId: null, config: null },
  };
}

@Injectable()
export class FilterStateService {
  private readonly logger = new Logger(FilterStateService.name);
  private state: ActiveFilterState | null = null;
  private loading: Promise<ActiveFilterState> | null = null;

  constructor(private readonly store: StoreService) {}

  /** Текущее состояние фильтров: после рестарта читается с диска, а не обнуляется. */
  async current(): Promise<ActiveFilterState> {
    if (this.state) return this.state;
    if (!this.loading) this.loading = this.load();
    return this.loading;
  }

  /** Записывает состояние целиком; частичное сохранение делает результат невоспроизводимым. */
  async save(state: ActiveFilterState): Promise<ActiveFilterState> {
    this.state = state;
    await this.store.saveState(STATE_NAME, state);
    return state;
  }

  private async load(): Promise<ActiveFilterState> {
    const stored = await this.store.loadState<Partial<ActiveFilterState>>(STATE_NAME);
    const blank = emptyFilterState();
    const state: ActiveFilterState = {
      screen: { ...blank.screen, ...(stored?.screen ?? {}) },
      alpha: { ...blank.alpha, ...(stored?.alpha ?? {}) },
    };

    // Включённый фильтр без конфигурации — не «включён по умолчанию», а испорченный
    // файл: тихо подставить default значит показать чужой отбор как ваш.
    if (state.screen.enabled && state.screen.profile === null) {
      this.logger.warn(
        'В состоянии screen включён без конфигурации — фильтр выключен. ' +
          'Включите его заново через POST /universe/screen',
      );
      state.screen = { ...blank.screen };
    }

    // Состояние переживает релизы, а публичный контракт — нет: встроенный профиль
    // прошлого релиза может содержать уже удалённые поля или старую формулу alpha.
    // Валидный сохранённый профиль оставляем для воспроизводимости; невалидный
    // builtin восстанавливаем по его стабильному id, разовый безопасно выключаем.
    if (state.screen.profile !== null) {
      try {
        state.screen.profile = parseAnalysisProfile(state.screen.profile);
      } catch {
        const builtin = state.screen.profileId ? getProfile(state.screen.profileId) : null;
        if (builtin) {
          this.logger.warn(`Сохранённый профиль ${builtin.id} мигрирован на текущий контракт`);
          state.screen.profile = builtin;
        } else {
          this.logger.warn('Сохранённый разовый screen-профиль несовместим — фильтр выключен');
          state.screen = { ...blank.screen };
        }
      }
    }

    if (state.alpha.config !== null) {
      try {
        state.alpha.config = parseAlphaConfig(state.alpha.config);
      } catch {
        const builtin = state.alpha.profileId ? getProfile(state.alpha.profileId) : null;
        if (builtin) {
          this.logger.warn(`Сохранённая alpha ${builtin.id} мигрирована на business scale`);
          state.alpha.config = builtin.alpha;
        } else {
          this.logger.warn('Сохранённая разовая alpha несовместима — фильтр выключен');
          state.alpha = { ...blank.alpha };
        }
      }
    }

    this.state = state;
    return state;
  }
}
