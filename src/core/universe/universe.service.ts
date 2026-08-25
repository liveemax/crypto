import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DISCOVERY } from '../../config/discovery';
import { DEFAULT_PROFILE, getProfile } from '../../config/profiles';
import { StoreService } from '../store/store.service';
import { UniverseBuilder } from './universe.builder';
import { UniverseFilter } from './universe.filter';
import { parseAnalysisProfile } from './profile.schema';
import type { AnalysisProfile } from './profile.types';
import {
  BuildProgressEvent,
  CandidateRef,
  FunnelReport,
  ProfileReference,
  ProfileSelection,
  TierChange,
  UniverseCandidate,
  UniverseCompareResult,
  UniverseProgress,
  UniverseRefreshResult,
  UniverseScreenResult,
  UniverseSnapshot,
  UniverseStatus,
} from './universe.types';
import { JobService } from '../jobs/job.service';

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
      /**
   * Отбор, выбранный последним POST /universe/screen. Снимок фактов он не
   * трогает — меняется только то, какой ответ на них считается рабочим.
   * Живёт в памяти процесса: после перезапуска сбрасывается на базовый.
   */
  private activeProfile: AnalysisProfile = DEFAULT_PROFILE;

  constructor(
    private readonly store: StoreService,
    private readonly builder: UniverseBuilder,
    private readonly filter: UniverseFilter,
    private readonly jobs: JobService,
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

  /** Возвращает кандидатов, прошедших отбор профиля; вшитые в снимок флаги не используются. */
  async passed(profile: AnalysisProfile = DEFAULT_PROFILE): Promise<UniverseCandidate[]> {
    const snapshot = await this.latest();
    if (!snapshot) return [];
    return this.screenSnapshot(snapshot, profile).candidates.filter((item) => item.passed);
  }

  /** Применяет профиль к последнему снимку без сети и без изменения снимка. */
  async screen(selection: ProfileSelection = {}): Promise<UniverseScreenResult> {
    const snapshot = await this.requireLatest();
    return this.screenSnapshot(snapshot, this.resolveProfile(selection));
  }

  /** Сравнивает два профиля на одном неизменном снимке без сетевых запросов. */
  async compare(
    leftRef: ProfileReference,
    rightRef: ProfileReference,
  ): Promise<UniverseCompareResult> {
    const snapshot = await this.requireLatest();
    const left = this.screenSnapshot(snapshot, this.resolveProfile(leftRef));
    const right = this.screenSnapshot(snapshot, this.resolveProfile(rightRef));
    const rightById = new Map(
      right.candidates.map((candidate) => [candidate.coingeckoId, candidate]),
    );
    const leftPassed = new Set(
      left.candidates
        .filter((candidate) => candidate.passed)
        .map((candidate) => candidate.coingeckoId),
    );
    const rightPassed = new Set(
      right.candidates
        .filter((candidate) => candidate.passed)
        .map((candidate) => candidate.coingeckoId),
    );

    const both: CandidateRef[] = [];
    const onlyLeft: CandidateRef[] = [];
    const onlyRight: CandidateRef[] = [];
    const tierChanges: TierChange[] = [];
    for (const candidate of left.candidates) {
      const ref = candidateRef(candidate);
      if (candidate.passed && rightPassed.has(candidate.coingeckoId)) both.push(ref);
      else if (candidate.passed) onlyLeft.push(ref);

      const other = rightById.get(candidate.coingeckoId);
      if (other && other.tier !== candidate.tier) {
        tierChanges.push({ ...ref, left: candidate.tier, right: other.tier });
      }
    }
    for (const candidate of right.candidates) {
      if (candidate.passed && !leftPassed.has(candidate.coingeckoId)) {
        onlyRight.push(candidateRef(candidate));
      }
    }

    return {
      universeVersion: snapshot.version,
      builtAt: snapshot.builtAt,
      left: { profile: left.profile, funnel: left.funnel },
      right: { profile: right.profile, funnel: right.funnel },
      both,
      onlyLeft,
      onlyRight,
      tierChanges,
    };
  }

  /** Обновляет числа готового состава, сохраняя дату и участников вселенной. */
  async refreshPrices(): Promise<UniverseRefreshResult> {
    const ageDays = await this.ageDays();
    const busy = this.jobs.current;
    if (busy) {
      return {
        started: false,
        reason: 'already_running',
        ageDays,
        message:
          `Уже идёт «${busy.name}», ${busy.elapsedSec} с. Одновременно выполняется ` +
          'одна сетевая задача: лимит CoinGecko общий на процесс',
      };
    }
    await this.requireLatest();

    if (!this.jobs.tryAcquire('universe/prices')) {
      return {
        started: false,
        reason: 'already_running',
        ageDays,
        message: 'Слот занят другой задачей. Проверьте GET /universe/status',
      };
    }
    this.state = 'running';
    this.lastError = null;
    this.failures = 0;
    this.startedAtMs = Date.now();
    this.progress = {
      ...idleProgress(),
      step: 'prices',
      label: 'Старт обновления чисел',
      startedAt: new Date().toISOString(),
    };

    this.inFlight = this.rerunPrices().catch((error: unknown) => {
      this.state = 'error';
      this.lastError = error instanceof Error ? error.message : String(error);
      this.progress = {
        ...this.progress,
        step: 'failed',
        label: 'Прервано',
        lastError: this.lastError,
      };
      this.logger.error(`Обновление чисел прервано: ${this.lastError}`);
    }).finally(() => this.jobs.release('universe/prices'));

    return {
      started: true,
      reason: 'forced',
      ageDays,
      message:
        'Обновление чисел запущено в фоне: около 9 запросов и до минуты работы. ' +
        'Ход — в GET /universe/status, результат — в POST /universe/screen',
    };
  }

  /** Тянет свежие числа по готовому составу; участники и дата сборки не меняются. */
  private async rerunPrices(): Promise<void> {
    const snapshot = await this.requireLatest();

    this.report({
      step: 'prices',
      label: 'Рынок CoinGecko и три сводки комиссий DeFiLlama',
      current: 0,
      total: 1,
      loaded: snapshot.candidates.length,
      failed: false,
      error: null,
    });
    const output = await this.builder.refreshNumbers(snapshot.candidates);

    const refreshed: UniverseSnapshot = {
      ...snapshot,
      sources: { ...snapshot.sources, ...output.sources },
      candidates: output.candidates,
      profileId: DEFAULT_PROFILE.id,
      funnel: this.filter.apply(
        output.candidates,
        new Set(snapshot.excludedIds),
        DEFAULT_PROFILE,
      ),
      warnings: [...new Set([...snapshot.warnings, ...output.warnings])],
    };

    this.report({
      step: 'save',
      label: 'Сохранение снапшота',
      current: 1,
      total: 1,
      loaded: refreshed.candidates.length,
      failed: false,
      error: null,
    });
    await this.store.saveSnapshot(SNAPSHOT_NAME, refreshed);

    this.state = 'idle';
    this.progress = this.withElapsed({
      ...this.progress,
      step: 'done',
      label: `Числа обновлены: ${refreshed.candidates.length} строк`,
      current: 1,
      total: 1,
      percent: 100,
    });
    this.logger.log(this.progress.label);
  }

  /** Пересобирает состав вселенной, если он старше месяца; работа идёт в фоне. */
  async ensureFresh(
    options: { force?: boolean; topN?: number } = {},
  ): Promise<UniverseRefreshResult> {
    const ageDays = await this.ageDays();

    const busy = this.jobs.current;
    if (busy) {
      return {
        started: false,
        reason: 'already_running',
        ageDays,
        message:
          `Уже идёт «${busy.name}», ${busy.elapsedSec} с. Одновременно выполняется ` +
          'одна сетевая задача: лимит CoinGecko общий на процесс',
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
    if (!this.jobs.tryAcquire('universe/refresh')) {
      return {
        started: false,
        reason: 'already_running',
        ageDays,
        message: 'Слот занят другой задачей. Проверьте GET /universe/status',
      };
    }
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
    }).finally(() => this.jobs.release('universe/refresh'));

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
    const funnel = this.filter.apply(output.candidates, output.excluded, DEFAULT_PROFILE);

    const snapshot: UniverseSnapshot = {
      version: new Date().toISOString().slice(0, 10),
      builtAt: new Date().toISOString(),
      topN,
      sources: output.sources,
      candidates: output.candidates,
      excludedIds: [...output.excluded].sort(),
      profileId: DEFAULT_PROFILE.id,
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

  private async requireLatest(): Promise<UniverseSnapshot> {
    const snapshot = await this.latest();
    if (!snapshot) {
      throw new NotFoundException(
        'Вселенная ещё не собрана. Вызовите POST /universe/refresh',
      );
    }
    return snapshot;
  }

  private screenSnapshot(
    snapshot: UniverseSnapshot,
    profile: AnalysisProfile,
  ): UniverseScreenResult {
    const candidates = snapshot.candidates.map((candidate) => ({
      ...candidate,
      defillamaSlugs: [...candidate.defillamaSlugs],
    }));
    const funnel = this.filter.apply(candidates, new Set(snapshot.excludedIds), profile);
    return {
      universeVersion: snapshot.version,
      builtAt: snapshot.builtAt,
      profile,
      funnel,
      candidates,
    };
  }

  private resolveProfile(reference: ProfileReference): AnalysisProfile {
    if (typeof reference === 'string') return this.requireBuiltin(reference);
    if ('screen' in reference) return this.parseCustomProfile(reference);

    // Клиенты присылают null и пустую строку вместо отсутствия поля; это не «оба сразу».
    const profileId = reference.profileId?.trim() || null;
    const custom = reference.profile ?? null;
    if (profileId !== null && custom !== null) {
      throw new BadRequestException(
        'Передайте что-то одно: profileId для готового профиля или profile для разового. ' +
          'Готовые: default, yield-hunter, deep-value.',
      );
    }
    if (custom !== null) return this.parseCustomProfile(custom);
    return this.requireBuiltin(profileId ?? DEFAULT_PROFILE.id);
  }

  private requireBuiltin(id: string): AnalysisProfile {
    const profile = getProfile(id.trim());
    if (!profile) {
      throw new BadRequestException(
        `Неизвестный profileId: ${id}. Доступные профили: default, yield-hunter, deep-value`,
      );
    }
    return profile;
  }

  private parseCustomProfile(value: unknown): AnalysisProfile {
    try {
      return parseAnalysisProfile(value);
    } catch (error: unknown) {
      const details = error instanceof Error ? `: ${error.message}` : '';
      throw new BadRequestException(`Разовый профиль не соответствует контракту${details}`);
    }
  }

    /** Запоминает выбранный отбор: он становится рабочим для status, funnel и списка. */
  setActive(profile: AnalysisProfile): void {
    this.activeProfile = profile;
  }

  /** Профиль по имени, а без имени — активный. */
  profileOr(profileId?: string): AnalysisProfile {
    const id = profileId?.trim();
    return id ? this.requireBuiltin(id) : this.activeProfile;
  }

  /** Воронка и кандидаты указанного отбора: ноль запросов, снимок не меняется. */
  async view(profileId?: string): Promise<UniverseScreenResult> {
    const snapshot = await this.requireLatest();
    return this.screenSnapshot(snapshot, this.profileOr(profileId));
  }

  /** passed и tiers активного отбора — то, что показывает status. */
  async activeSummary(): Promise<{
    profileId: string;
    passed: number;
    tiers: FunnelReport['tiers'];
  } | null> {
    const snapshot = await this.latest();
    if (!snapshot) return null;
    const { profile, funnel } = this.screenSnapshot(snapshot, this.activeProfile);
    return { profileId: profile.id, passed: funnel.passed, tiers: funnel.tiers };
  }
}

function candidateRef(candidate: UniverseCandidate): CandidateRef {
  return { coingeckoId: candidate.coingeckoId, ticker: candidate.ticker };
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
