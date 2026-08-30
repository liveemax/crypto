import { BadRequestException, Injectable } from '@nestjs/common';
import { DISCOVERY } from '../../config/discovery';
import { badRequest, NEXT, notFound } from '../errors';
import { paginate } from '../envelope';
import type { Envelope, ResponseContext } from '../envelope.types';
import { collectDataGaps } from './data-gaps';
import { comparator, defaultOrderFor } from './sort';
import { matchesSearch } from '../search';
import { summaryOf } from './summary';
import type { UniverseSummaryRow } from './summary';
import type { DataGapQuery, DataGapRow } from './data-gaps.types';
import type { UniverseListQuery, UniverseOptionsResponse } from './universe.types';
import { EMPTY_TOKENOMICS, TOKENOMICS_SNAPSHOT } from '../tokenomics/tokenomics.constants';
import { applyTokenomics, overhangPctOf } from '../tokenomics/tokenomics.calc';
import { DEFAULT_PROFILE, getProfile } from '../../config/profiles';
import { StoreService } from '../store/store.service';
import { UniverseBuilder } from './universe.builder';
import { UniverseFilter, countTiers } from './universe.filter';
import { applyAlpha } from './alpha';
import { buildCoverage } from './coverage';
import type { CoverageReport } from './coverage.types';
import { parseAlphaConfig, parseAnalysisProfile } from './profile.schema';
import { FilterStateService } from './filter-state.service';
import type {
  ActiveFilterState,
  AlphaFilterState,
  AlphaSelectionRequest,
  ScreenFilterState,
  ScreenSelectionRequest,
} from './filter-state.types';
import type { AlphaOutcome } from './alpha';
import type { CandidateView, UniverseStep } from './universe.types';
import type { AnalysisProfile } from './profile.types';
import {
  BuildProgressEvent,
  CandidateRef,
  AlphaApplyResult,
  ProfileReference,
  ScreenApplyResult,
  TierChange,
  UniverseCandidate,
  UniverseCompareResult,
  UniverseProgress,
  UniverseRefreshResult,
  UniverseScreenResult,
  UniverseSnapshot,
  UniverseStatus,
  UniverseView,
} from './universe.types';
import { JobService } from '../jobs/job.service';
import type { TokenomicsSnapshot } from '../tokenomics/tokenomics.types';

const SNAPSHOT_NAME = 'universe-source';
const DAY_MS = 86_400_000;

@Injectable()
export class UniverseService {
  /**
   * Своего состояния задачи здесь нет намеренно: два владельца означают, что
   * чужая задача видна как idle. Прогресс целиком принадлежит JobService.
   */
  private inFlight: Promise<void> | null = null;
  constructor(
    private readonly store: StoreService,
    private readonly builder: UniverseBuilder,
    private readonly filter: UniverseFilter,
    private readonly jobs: JobService,
    private readonly filters: FilterStateService,
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

  /** Кандидаты, прошедшие все включённые фильтры; вшитые в снимок флаги не читаются. */
  async passed(): Promise<UniverseCandidate[]> {
    const snapshot = await this.latest();
    if (!snapshot) return [];
    const view = this.compose(snapshot, await this.filters.current());
    return view.candidates.filter((item) => item.passed);
  }

  /**
   * Разовый расчёт по произвольному профилю: состояние не меняет, в сеть не ходит.
   * Это не «второй рабочий отбор», а вычисление для сравнения профилей.
   */
  async screen(reference: ProfileReference = {}): Promise<UniverseScreenResult> {
    const snapshot = await this.requireLatest();
    return this.screenSnapshot(snapshot, this.resolveProfile(reference));
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

    if (!this.jobs.begin('universe/prices', 'prices', 'Цены, выручка и TVL')) {
      return {
        started: false,
        reason: 'already_running',
        ageDays,
        message: 'Слот занят другой задачей. Проверьте GET /status',
      };
    }

    this.inFlight = this.rerunPrices()
      .catch((error: unknown) => {
        this.jobs.fail(error);
      })
      .finally(() => this.jobs.release('universe/prices'));

    return {
      started: true,
      reason: 'forced',
      ageDays,
      message:
        'Обновление чисел запущено в фоне: около 9 запросов и до минуты работы. ' +
        'Ход — в GET /status, результат — в POST /universe/screen',
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

    // Календарь тот же, но circulating, цена и объём изменились. Без пересчёта
    // рядом со свежей ценой стояло бы разводнение от прошлого circulating —
    // подделка происхождения, которую валидатор не поймает.
    const stored = await this.store.loadSnapshot<TokenomicsSnapshot>(TOKENOMICS_SNAPSHOT);
    const facts = stored !== null && stored.universeVersion === snapshot.version ? stored : null;
    const applied = applyTokenomics(output.candidates, facts);

    const refreshed: UniverseSnapshot = {
      ...snapshot,
      sources: { ...snapshot.sources, ...output.sources },
      candidates: applied.candidates,
      profileId: undefined,
      funnel: undefined,
      warnings: [
        ...new Set([...snapshot.warnings, ...output.warnings, ...applied.warnings]),
      ],
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

    this.jobs.succeed(`Числа обновлены: ${refreshed.candidates.length} строк`);
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
    if (!this.jobs.begin('universe/refresh', 'markets', 'Состав вселенной')) {
      return {
        started: false,
        reason: 'already_running',
        ageDays,
        message: 'Слот занят другой задачей. Проверьте GET /status',
      };
    }

    this.inFlight = this.rebuild(options.topN)
      .catch((error: unknown) => {
        this.jobs.fail(error);
      })
      .finally(() => this.jobs.release('universe/refresh'));

    return {
      started: true,
      reason,
      ageDays,
      message: 'Пересборка запущена в фоне: около 25 запросов и 3–5 минут. Ход — в GET /status',
    };
  }

  /** Дожидается завершения текущей пересборки — нужен в тестах и в ручных прогонах. */
  async wait(): Promise<void> {
    if (this.inFlight) await this.inFlight;
  }

  /**
   * Запускает фоновую сетевую задачу другого модуля под общим замком и общим
   * счётчиком. Своё состояние в чужом сервисе означает, что идущая задача видна
   * в GET /universe/status как idle.
   */
  async runExternalJob(
    name: string,
    step: UniverseStep,
    label: string,
    run: (report: (event: BuildProgressEvent) => void) => Promise<string>,
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
          'одна сетевая задача: лимит источников общий на процесс',
      };
    }
    if (!this.jobs.begin(name, step, label)) {
      return {
        started: false,
        reason: 'already_running',
        ageDays,
        message: 'Слот занят другой задачей. Проверьте GET /status',
      };
    }

    this.inFlight = run((event) => this.report(event))
      .then((done) => this.jobs.succeed(done))
      .catch((error: unknown) => {
        this.jobs.fail(error);
      })
      .finally(() => this.jobs.release(name));

    return {
      started: true,
      reason: 'forced',
      ageDays,
      message: `${label}: задача запущена в фоне. Ход — в GET /status`,
    };
  }

  /**
   * Записывает пересчитанные числа в тот же снимок. Состав, version и builtAt
   * не меняются: второй слой данных поверх вселенной — это уже пройденная
   * ошибка с asOfFees, равным времени запроса.
   */
  async saveNumbers(update: {
    candidates: UniverseCandidate[];
    sources?: Record<string, string>;
    warnings?: string[];
  }): Promise<void> {
    const snapshot = await this.requireLatest();
    await this.store.saveSnapshot(SNAPSHOT_NAME, {
      ...snapshot,
      sources: { ...snapshot.sources, ...(update.sources ?? {}) },
      candidates: update.candidates,
      profileId: undefined,
      funnel: undefined,
      warnings: [...new Set([...snapshot.warnings, ...(update.warnings ?? [])])],
    } satisfies UniverseSnapshot);
  }

  /** Счётчик пересборки и текущий результат композиции фильтров. */
  async status(): Promise<UniverseStatus> {
    const snapshot = await this.latest();
    const activeFilters = await this.filters.current();
    const view = snapshot ? this.compose(snapshot, activeFilters) : null;
    // Прогресс читается у владельца состояния; 'done' наружу выглядит как покой.
    const job = this.jobs.snapshot();
    return {
      state: job.state === 'running' ? 'running' : job.state === 'error' ? 'error' : 'idle',
      progress: {
        step: job.step,
        label: job.label,
        current: job.current,
        total: job.total,
        percent: job.percent,
        loaded: job.loaded,
        failures: job.failures,
        lastError: job.lastError,
        startedAt: job.startedAt,
        elapsedSec: job.elapsedSec,
        etaSec: job.etaSec,
      },
      error: job.lastError,
      version: snapshot?.version ?? null,
      ageDays: await this.ageDays(),
      total: snapshot?.candidates.length ?? null,
      passed: view?.funnel.passed ?? null,
      tiers: view?.funnel.tiers ?? null,
      activeFilters,
      profileId: activeFilters.screen.enabled ? activeFilters.screen.profileId : null,
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
    // Воронка считается на копиях и только ради строки лога: мнение базового
    // профиля не консервируется в файле фактов и не переживает смену фильтра.
    const funnel = this.filter.apply(
      output.candidates.map((candidate) => ({ ...candidate })),
      output.excluded,
      DEFAULT_PROFILE,
    );

    const snapshot: UniverseSnapshot = {
      version: new Date().toISOString().slice(0, 10),
      builtAt: new Date().toISOString(),
      topN,
      sources: output.sources,
      candidates: output.candidates,
      excludedIds: [...output.excluded].sort(),
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

    this.jobs.succeed(
      `Готово: ${funnel.passed} из ${funnel.total}, с доходностью ${funnel.tiers.yield}`,
    );
  }

  /** Счётчик и строка лога принадлежат JobService: владелец состояния задачи один. */
  private report(event: BuildProgressEvent): void {
    this.jobs.report(event);
  }

  private async requireLatest(): Promise<UniverseSnapshot> {
    const snapshot = await this.latest();
    if (!snapshot) {
      throw notFound(
        'universe_missing',
        'Состав вселенной ещё не собран: показывать нечего.',
        { expected: 'universe snapshot', actual: null },
        NEXT.buildUniverse,
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
      throw badRequest(
        'profile_unknown',
        `Неизвестный profileId: ${id}.`,
        { requested: id, available: ['default', 'yield-hunter', 'deep-value'] },
        NEXT.profiles,
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

  /** Текущий результат: ноль сетевых запросов, снимок не меняется. */
  async view(): Promise<UniverseView> {
    const snapshot = await this.requireLatest();
    return this.compose(snapshot, await this.filters.current());
  }

  /** Происхождение любого списка: снимок, композиция фильтров и время ответа. */
  contextOf(view: UniverseView): ResponseContext {
    return {
      universeVersion: view.universeVersion,
      builtAt: view.builtAt,
      activeFilters: view.activeFilters,
      asOf: new Date().toISOString(),
    };
  }

  /**
   * Список кандидатов страницами и в конверте: голый массив не объясняет
   * происхождение. Порядок обработки: active selection → passedOnly/tier/
   * sector/q → sort/order → pagination → summary/full.
   */
  async list(
    query: UniverseListQuery = {},
  ): Promise<Envelope<CandidateView | UniverseSummaryRow>> {
    const view = await this.view();
    const passedOnly = query.passedOnly ?? true;
    const sector = query.sector?.trim().toLowerCase();
    const q = query.q?.trim().toLowerCase();
    const sort = query.sort ?? 'rank';
    const order = query.order ?? defaultOrderFor(sort);
    const rows = view.candidates
      .filter((item) => (passedOnly ? item.passed : true))
      .filter((item) => (query.tier ? item.tier === query.tier : true))
      .filter((item) => (sector ? item.sector === sector : true))
      .filter((item) => (q ? matchesSearch(q, item.name, item.ticker, item.coingeckoId) : true))
      .sort(comparator(sort, order));

    const { page, pagination } = paginate(rows, query);
    // Полная строка едет в браузер только по явному запросу: перцентили и peers
    // читают, когда разбирают один токен, а не когда листают список.
    const items = query.view === 'full' ? page : page.map(summaryOf);
    return { context: this.contextOf(view), pagination, items };
  }

  /** Сектора всей текущей вселенной для тулбара фильтров: не страница и не только passed. */
  async options(): Promise<UniverseOptionsResponse> {
    const view = await this.view();
    const sectors = [
      ...new Set(
        view.candidates
          .map((item) => item.sector?.trim().toLowerCase())
          .filter((sector): sector is string => Boolean(sector)),
      ),
    ].sort();
    return { context: this.contextOf(view), sectors };
  }

  /** Типизированная очередь пробелов: что мешает посчитать числа и по каким токенам. */
  async dataGaps(query: DataGapQuery = {}): Promise<Envelope<DataGapRow>> {
    const view = await this.view();
    const rows = collectDataGaps(view.candidates, query);
    const { page, pagination } = paginate(rows, query);
    return { context: this.contextOf(view), pagination, items: page };
  }

  /**
   * Кандидаты по тикеру или coingeckoId. Совпадение по идентификатору сильнее:
   * тикер не идентификатор, и один символ у двух активов — законная ситуация.
   */
  async resolve(token: string): Promise<{ view: UniverseView; matches: CandidateView[] }> {
    const view = await this.view();
    const needle = token.trim().toLowerCase();
    const byId = view.candidates.filter((item) => item.coingeckoId.toLowerCase() === needle);
    if (byId.length > 0) return { view, matches: byId };
    return { view, matches: view.candidates.filter((item) => item.ticker.toLowerCase() === needle) };
  }

  /**
   * Покрытие групп сравнения на входе альфы. Сама альфа при подсчёте выключается:
   * иначе включённый фильтр улучшает метрику, удаляя как раз тех, кого не покрыли.
   */
  async coverage(): Promise<CoverageReport> {
    const snapshot = await this.requireLatest();
    const state = await this.filters.current();
    const input = this.compose(snapshot, {
      ...state,
      alpha: { ...state.alpha, enabled: false },
    });
    return buildCoverage(
      input.candidates.filter((item) => item.passed),
      {
        universeVersion: input.universeVersion,
        builtAt: input.builtAt,
        activeFilters: state,
      },
    );
  }

  /** Включает или выключает фильтр шлака и сохраняет состояние на диск. */
  async applyScreen(request: ScreenSelectionRequest): Promise<ScreenApplyResult> {
    const snapshot = await this.requireLatest();
    const previous = await this.filters.current();
    const next: ActiveFilterState = {
      ...previous,
      screen: this.nextScreenState(request, previous.screen),
    };
    await this.filters.save(next);

    const view = this.compose(snapshot, next);
    return {
      universeVersion: view.universeVersion,
      builtAt: view.builtAt,
      activeFilters: next,
      before: view.funnel.total,
      after: view.funnel.passed,
      funnel: view.funnel,
    };
  }

  /**
   * Новое состояние фильтра. Выключение не стирает конфигурацию: включить обратно
   * тем же профилем должно быть одним вызовом, иначе «выключить и посмотреть»
   * стоит повторного ввода настроек.
   */
  private nextScreenState(
    request: ScreenSelectionRequest,
    previous: ScreenFilterState,
  ): ScreenFilterState {
    if (typeof request.enabled !== 'boolean') {
      throw new BadRequestException('Поле enabled обязательно: true включает фильтр, false выключает');
    }
    if (!request.enabled) {
      if (request.profileId !== undefined || request.profile !== undefined) {
        throw new BadRequestException(
          'При enabled: false профиль не принимается — выключенному фильтру нечего настраивать',
        );
      }
      return { ...previous, enabled: false };
    }

    const profileId = request.profileId?.trim() || null;
    const custom = request.profile ?? null;
    if (profileId !== null && custom !== null) {
      throw new BadRequestException(
        'Передайте что-то одно: profileId для готового профиля или profile для разового. ' +
          'Готовые: default, yield-hunter, deep-value.',
      );
    }
    if (custom !== null) {
      return { enabled: true, profileId: null, profile: this.parseCustomProfile(custom) };
    }
    if (profileId !== null) {
      const builtin = this.requireBuiltin(profileId);
      return { enabled: true, profileId: builtin.id, profile: builtin };
    }
    if (previous.profile !== null) return { ...previous, enabled: true };
    return { enabled: true, profileId: DEFAULT_PROFILE.id, profile: DEFAULT_PROFILE };
  }

  /** Включает или выключает отбор лидеров ниш и сохраняет состояние на диск. */
  async applyAlphaFilter(request: AlphaSelectionRequest): Promise<AlphaApplyResult> {
    const snapshot = await this.requireLatest();
    const previous = await this.filters.current();
    const next: ActiveFilterState = {
      ...previous,
      alpha: this.nextAlphaState(request, previous.alpha),
    };
    await this.filters.save(next);

    const view = this.compose(snapshot, next);
    const alphaStage = view.funnel.stages.find((stage) => stage.filter === 'alpha');
    return {
      universeVersion: view.universeVersion,
      builtAt: view.builtAt,
      activeFilters: next,
      before: alphaStage?.incoming ?? view.funnel.passed,
      after: view.funnel.passed,
      dropped: alphaStage?.dropped ?? 0,
      sectors: view.sectors,
      dataGaps: view.dataGaps.slice(0, 50),
      dataGapsTotal: view.dataGaps.length,
      funnel: view.funnel,
      warnings: view.warnings,
      status: await this.status(),
    };
  }

  private nextAlphaState(
    request: AlphaSelectionRequest,
    previous: AlphaFilterState,
  ): AlphaFilterState {
    if (typeof request.enabled !== 'boolean') {
      throw new BadRequestException('Поле enabled обязательно: true включает фильтр, false выключает');
    }
    if (!request.enabled) {
      if (request.profileId !== undefined || request.alpha !== undefined) {
        throw new BadRequestException(
          'При enabled: false конфигурация не принимается — выключенному фильтру нечего настраивать',
        );
      }
      return { ...previous, enabled: false };
    }

    const profileId = request.profileId?.trim() || null;
    const custom = request.alpha ?? null;
    if (profileId !== null && custom !== null) {
      throw new BadRequestException(
        'Передайте что-то одно: profileId готового профиля или alpha для разовой конфигурации',
      );
    }
    if (custom !== null) {
      try {
        return { enabled: true, profileId: null, config: parseAlphaConfig(custom) };
      } catch (error: unknown) {
        const details = error instanceof Error ? `: ${error.message}` : '';
        throw new BadRequestException(`Разовая конфигурация альфы не соответствует контракту${details}`);
      }
    }
    if (profileId !== null) {
      const builtin = this.requireBuiltin(profileId);
      return { enabled: true, profileId: builtin.id, config: builtin.alpha };
    }
    if (previous.config !== null) return { ...previous, enabled: true };
    return { enabled: true, profileId: DEFAULT_PROFILE.id, config: DEFAULT_PROFILE.alpha };
  }

  /**
   * Собирает представление из фактов и включённых фильтров. Порядок фиксирован
   * кодом, а не порядком HTTP-вызовов; копии кандидатов не дают мутировать снимок.
   */
  private compose(snapshot: UniverseSnapshot, state: ActiveFilterState): UniverseView {
    const candidates: CandidateView[] = snapshot.candidates.map((candidate) => ({
      ...candidate,
      defillamaSlugs: [...candidate.defillamaSlugs],
      alpha: null,
    }));

    // Порядок задан кодом, а не порядком HTTP-вызовов: альфа всегда считается
    // поверх выхода screen, даже если её включили раньше.
    const funnel =
      state.screen.enabled && state.screen.profile !== null
        ? this.filter.apply(candidates, new Set(snapshot.excludedIds), state.screen.profile)
        : this.filter.passAll(candidates);

    let outcome: AlphaOutcome | null = null;
    if (state.alpha.enabled && state.alpha.config !== null) {
      outcome = applyAlpha(candidates, state.alpha.config);
      funnel.stages.push(outcome.stage);
      funnel.passed = outcome.stage.kept;
      funnel.tiers = countTiers(candidates);
    }

    return {
      universeVersion: snapshot.version,
      builtAt: snapshot.builtAt,
      activeFilters: state,
      funnel,
      candidates,
      sectors: outcome?.sectors ?? [],
      dataGaps: outcome?.dataGaps ?? [],
      warnings: outcome?.warnings ?? [],
    };
  }
}
function candidateRef(candidate: UniverseCandidate): CandidateRef {
  return { coingeckoId: candidate.coingeckoId, ticker: candidate.ticker };
}

/**
 * Описывает изменение состава относительно прошлой вселенной. Сравнивается весь
 * состав, а не «прошедшие»: кто прошёл — зависит от фильтра, а не от сборки.
 */
function diff(previous: UniverseSnapshot, current: UniverseSnapshot): string[] {
  const before = new Set(previous.candidates.map((i) => i.ticker));
  const after = new Set(current.candidates.map((i) => i.ticker));
  const added = [...after].filter((ticker) => !before.has(ticker));
  const removed = [...before].filter((ticker) => !after.has(ticker));
  return [
    `Относительно вселенной ${previous.version}: добавлено ${added.length}, выбыло ${removed.length}`,
    `Добавлены: ${added.slice(0, 50).join(', ') || '—'}`,
    `Выбыли: ${removed.slice(0, 50).join(', ') || '—'}`,
  ];
}
