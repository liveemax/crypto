import { Injectable, Logger } from '@nestjs/common';
import { DISCOVERY } from '../../config/discovery';
import { StoreService } from '../store/store.service';
import { UniverseBuilder } from './universe.builder';
import { UniverseFilter } from './universe.filter';
import {
  BuildProgressEvent,
  UniverseCandidate,
  UniverseProgress,
  UniverseRefreshResult,
  UniverseSnapshot,
  UniverseStatus,
} from './universe.types';

const SNAPSHOT_NAME = 'universe-source';
const DAY_MS = 86_400_000;

/** Пустой счётчик: состояние покоя. */
function idleProgress(): UniverseProgress {
  return {
    step: 'idle',
    label: 'Ожидание',
    current: 0,
    total: 0,
    percent: 0,
    loaded: 0,
    failures: 0,
    lastError: null,
    startedAt: null,
    elapsedSec: 0,
    etaSec: null,
  };
}

@Injectable()
export class UniverseService {
  private readonly logger = new Logger(UniverseService.name);
  private state: UniverseStatus['state'] = 'idle';
  private progress: UniverseProgress = idleProgress();
  private lastError: string | null = null;
  private inFlight: Promise<void> | null = null;
  private startedAtMs = 0;
  private failures = 0;

  constructor(
    private readonly store: StoreService,
    private readonly builder: UniverseBuilder,
    private readonly filter: UniverseFilter,
  ) {}

  /** Возвращает последний сохранённый состав вселенной или null. */
  async latest(): Promise<UniverseSnapshot | null> {
    return this.store.loadSnapshot<UniverseSnapshot>(SNAPSHOT_NAME);
  }

  /** Возвращает возраст состава вселенной в днях или null, если она не собиралась. */
  async ageDays(): Promise<number | null> {
    const snapshot = await this.latest();
    if (!snapshot) return null;
    const built = Date.parse(snapshot.builtAt);
    return Number.isFinite(built) ? Math.floor((Date.now() - built) / DAY_MS) : null;
  }

  /** Возвращает кандидатов, прошедших шлак-фильтр. */
  async passed(): Promise<UniverseCandidate[]> {
    const snapshot = await this.latest();
    return snapshot?.candidates.filter((item) => item.passed) ?? [];
  }

  /** Пересобирает состав вселенной, если он старше месяца; работа идёт в фоне. */
  async ensureFresh(
    options: { force?: boolean; topN?: number } = {},
  ): Promise<UniverseRefreshResult> {
    const ageDays = await this.ageDays();

    if (this.state === 'running') {
      return {
        started: false,
        reason: 'already_running',
        ageDays,
        message: `Пересборка уже идёт: ${this.progress.label} ${this.progress.current}/${this.progress.total}`,
      };
    }

    const stale = ageDays === null || ageDays >= DISCOVERY.refreshDays;
    if (!stale && !options.force) {
      return {
        started: false,
        reason: 'fresh',
        ageDays,
        message:
          `Состав вселенной собран ${ageDays} дн. назад, пересборка не нужна. ` +
          'Принудительно: force=true',
      };
    }

    const reason = options.force ? 'forced' : ageDays === null ? 'never_built' : 'stale';
    this.state = 'running';
    this.lastError = null;
    this.failures = 0;
    this.startedAtMs = Date.now();
    this.progress = {
      ...idleProgress(),
      step: 'markets',
      label: 'Старт',
      startedAt: new Date().toISOString(),
    };

    this.inFlight = this.rebuild(options.topN).catch((error: unknown) => {
      this.state = 'error';
      this.lastError = error instanceof Error ? error.message : String(error);
      this.progress = { ...this.progress, step: 'failed', label: 'Прервано', lastError: this.lastError };
      this.logger.error(`Пересборка вселенной прервана: ${this.lastError}`);
    });

    return {
      started: true,
      reason,
      ageDays,
      message: 'Пересборка запущена в фоне. Счётчик — в GET /universe/status',
    };
  }

  /** Дожидается завершения текущей пересборки — нужен в тестах и в ручных прогонах. */
  async wait(): Promise<void> {
    if (this.inFlight) await this.inFlight;
  }

  /** Возвращает счётчик пересборки и сводку по последнему составу. */
  async status(): Promise<UniverseStatus> {
    const snapshot = await this.latest();
    return {
      state: this.state,
      progress: this.withElapsed(this.progress),
      error: this.lastError,
      version: snapshot?.version ?? null,
      ageDays: await this.ageDays(),
      total: snapshot?.candidates.length ?? null,
      passed: snapshot?.funnel.passed ?? null,
      tiers: snapshot?.funnel.tiers ?? null,
    };
  }

  private async rebuild(topN: number = DISCOVERY.topN): Promise<void> {
    const output = await this.builder.build(topN, (event) => this.report(event));

    this.report({
      step: 'filter',
      label: 'Воронка отсева',
      current: 0,
      total: 1,
      loaded: output.candidates.length,
      failed: false,
      error: null,
    });
    const funnel = this.filter.apply(output.candidates, output.excluded);

    const snapshot: UniverseSnapshot = {
      version: new Date().toISOString().slice(0, 10),
      builtAt: new Date().toISOString(),
      topN,
      sources: output.sources,
      candidates: output.candidates,
      funnel,
      warnings: output.warnings,
    };

    const previous = await this.latest();
    if (previous) snapshot.warnings.push(...diff(previous, snapshot));

    this.report({
      step: 'save',
      label: 'Сохранение снапшота',
      current: 1,
      total: 1,
      loaded: output.candidates.length,
      failed: false,
      error: null,
    });
    await this.store.saveSnapshot(SNAPSHOT_NAME, snapshot);

    this.state = 'idle';
    this.progress = this.withElapsed({
      ...this.progress,
      step: 'done',
      label: `Готово: ${funnel.passed} из ${funnel.total}, с доходностью ${funnel.tiers.yield}`,
      current: 1,
      total: 1,
      percent: 100,
    });
    this.logger.log(this.progress.label);
  }

  /** Обновляет счётчик и пишет строку лога с номером шага и остатком времени. */
  private report(event: BuildProgressEvent): void {
    if (event.failed) this.failures += 1;

    const percent = event.total > 0 ? Math.round((event.current / event.total) * 100) : 0;
    this.progress = this.withElapsed({
      step: event.step,
      label: event.label,
      current: event.current,
      total: event.total,
      percent,
      loaded: event.loaded,
      failures: this.failures,
      lastError: event.error ?? this.progress.lastError,
      startedAt: this.progress.startedAt,
      elapsedSec: 0,
      etaSec: null,
    });

    const counter = event.total > 1 ? ` ${event.current}/${event.total}` : '';
    const eta = this.progress.etaSec === null ? '' : ` · осталось ~${this.progress.etaSec} с`;
    const line =
      `${event.label}${counter} · строк ${event.loaded} · ошибок ${this.failures}` +
      ` · прошло ${this.progress.elapsedSec} с${eta}`;

    if (event.failed) this.logger.warn(`${line} · ${event.error ?? 'ошибка'}`);
    else this.logger.log(line);
  }

  /** Досчитывает прошедшее время и остаток по темпу текущего шага. */
  private withElapsed(progress: UniverseProgress): UniverseProgress {
    const elapsedSec =
      this.startedAtMs === 0 ? 0 : Math.round((Date.now() - this.startedAtMs) / 1_000);
    const etaSec =
      progress.current > 0 && progress.total > progress.current && elapsedSec > 0
        ? Math.round((elapsedSec / progress.current) * (progress.total - progress.current))
        : null;
    return { ...progress, elapsedSec, etaSec };
  }
}

/** Описывает изменение состава относительно прошлой вселенной. */
function diff(previous: UniverseSnapshot, current: UniverseSnapshot): string[] {
  const before = new Set(previous.candidates.filter((i) => i.passed).map((i) => i.ticker));
  const after = new Set(current.candidates.filter((i) => i.passed).map((i) => i.ticker));
  const added = [...after].filter((ticker) => !before.has(ticker));
  const removed = [...before].filter((ticker) => !after.has(ticker));
  return [
    `Относительно вселенной ${previous.version}: добавлено ${added.length}, выбыло ${removed.length}`,
    `Добавлены: ${added.slice(0, 50).join(', ') || '—'}`,
    `Выбыли: ${removed.slice(0, 50).join(', ') || '—'}`,
  ];
}
