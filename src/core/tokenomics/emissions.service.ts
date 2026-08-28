import { Injectable, Logger } from '@nestjs/common';
import { StoreService } from '../store/store.service';
import { fetchJsonWithDate } from '../fetch/fetch.utils';
import { geckoIdsOf } from './emissions.parser';
import {
  EMISSIONS_LIST_URL,
  INDEX_CACHE_NS,
  INDEX_TTL_DAYS,
  emissionsDocumentUrl,
  unlocksPageUrl,
} from './tokenomics.constants';
import type { EmissionsIndex } from './tokenomics.types';

export interface EmissionsDocument {
  slug: string;
  ok: boolean;
  status: number | null;
  data: unknown;
  error: string | null;
  /** Ссылка для человека: она открывается и сверяется руками. */
  pageUrl: string;
  /** last-modified датасета: другой даты у документа нет. */
  asOf: string | null;
}

@Injectable()
export class EmissionsService {
  private readonly logger = new Logger(EmissionsService.name);

  constructor(private readonly store: StoreService) {}

  /** Возвращает слаги протоколов с календарём или null, если список не отдался. */
  async slugs(): Promise<string[] | null> {
    const response = await fetchJsonWithDate<unknown>(EMISSIONS_LIST_URL, { timeoutMs: 30_000 });
    if (!response.ok || !Array.isArray(response.data)) return null;
    const slugs = response.data.filter((item): item is string => typeof item === 'string');
    if (slugs.length === 0) return null;
    await this.store.saveRaw('defillama-emissions', 'protocols-list', slugs);
    return slugs;
  }

  /** Загружает один документ; сырой ответ сохраняет вызывающий, до разбора. */
  async document(slug: string): Promise<EmissionsDocument> {
    const response = await fetchJsonWithDate<unknown>(emissionsDocumentUrl(slug), {
      timeoutMs: 60_000,
    });
    return {
      slug,
      ok: response.ok,
      status: response.status,
      data: response.data,
      error: response.error,
      pageUrl: unlocksPageUrl(slug),
      asOf: isoOrNull(response.sourceDate),
    };
  }

  /**
   * Карта coingeckoId → слаг. Строится обходом всех документов, поэтому ключ
   * кэша — universeVersion: она меняется с составом, то есть раз в месяц.
   * Ежедневный прогон тянет только документы совпавших слагов, иначе 467 МБ
   * качаются на каждое обновление чисел.
   */
  async index(
    universeVersion: string,
    force: boolean,
    onProgress?: (scanned: number, total: number) => void,
  ): Promise<EmissionsIndex | null> {
    if (!force) {
      const cached = await this.store.cacheGet<EmissionsIndex>(
        INDEX_CACHE_NS,
        universeVersion,
        INDEX_TTL_DAYS,
      );
      // Пустой массив в JavaScript истинный: карта без документов — неудачный
      // прогон, который иначе притворялся бы фактом сутками.
      if (cached && cached.documents > 0) return cached;
    }

    const slugs = await this.slugs();
    if (slugs === null) {
      // Источник лёг. Карта прошлого прогона лучше отменённой задачи, но
      // вызывающий обязан назвать подмену в warnings, а не пережить её молча.
      const cached = await this.store.cacheGet<EmissionsIndex>(
        INDEX_CACHE_NS,
        universeVersion,
        INDEX_TTL_DAYS,
      );
      if (cached && cached.documents > 0) return { ...cached, stale: true };
      return null;
    }

    const byGecko: Record<string, string[]> = {};
    const scanned: string[] = [];
    const failed: string[] = [];

    for (const [position, slug] of slugs.entries()) {
      const document = await this.document(slug);
      if (!document.ok || document.data === null) {
        failed.push(slug);
      } else {
        scanned.push(slug);
        for (const id of geckoIdsOf(document.data)) {
          const list = byGecko[id];
          if (list) {
            if (!list.includes(slug)) list.push(slug);
          } else {
            byGecko[id] = [slug];
          }
        }
      }
      if (position % 25 === 0 || position === slugs.length - 1) {
        onProgress?.(position + 1, slugs.length);
      }
    }

    if (scanned.length === 0) return null;
    if (failed.length > 0) {
      this.logger.warn(`Документ не отдался у ${failed.length} слагов: ${failed.slice(0, 10).join(', ')}`);
    }

    const index: EmissionsIndex = {
      universeVersion,
      builtAt: new Date().toISOString(),
      documents: scanned.length,
      slugs: scanned,
      byGecko,
      failed,
      stale: false,
    };
    return this.store.cachePut(INDEX_CACHE_NS, universeVersion, index);
  }
}

/** last-modified приходит в RFC 1123; наружу все даты идут в ISO. */
function isoOrNull(value: string | null): string | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}