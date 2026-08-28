import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { div, pctOf, round } from '../money';
import { isRecord } from '../fetch/fetch.utils';
import { StoreService } from '../store/store.service';
import { UniverseService } from '../universe/universe.service';
import type { BuildProgressEvent, UniverseRefreshResult, UniverseSnapshot } from '../universe/universe.types';
import type { UniverseCandidate } from '../universe/universe.types';
import { ManualService } from '../manual/manual.service';
import type { ManualUnlockRecord } from '../manual/manual.types';
import { EmissionsService } from './emissions.service';
import { applyTokenomics } from './tokenomics.calc';
import {
  calendarNodes,
  completenessOf,
  parseCalendar,
  scheduledTotal,
  unlockedIn,
} from './emissions.parser';
import type { ParsedCalendar, RateSegment } from './emissions.parser';
import {
  DAY_SECONDS,
  EMISSIONS_LIST_URL,
  FLOAT_COMPLETE_PCT,
  HORIZON_DAYS,
  MANUAL_CONFLICT_RATIO,
  MAX_TBD_PCT,
  PROVIDER,
  REFRESH_TTL_HOURS,
  SCHEDULE_COMPLETE_PCT,
  TOKENOMICS_SNAPSHOT,
} from './tokenomics.constants';
import type {
  EmissionsIndex,
  TokenomicsFacts,
  TokenomicsSnapshot,
  UnlockEvent,
  UnlockStream,
} from './tokenomics.types';

interface SlugResult {
  calendar: ParsedCalendar | null;
  schedulePct: number | null;
  tbdPct: number | null;
  pageUrl: string;
  asOf: string | null;
  error: string | null;
}

@Injectable()
export class TokenomicsService {
  private readonly logger = new Logger(TokenomicsService.name);

  constructor(
    private readonly store: StoreService,
    private readonly emissions: EmissionsService,
    private readonly universe: UniverseService,
    private readonly manual: ManualService,
  ) {}

  /** Последний собранный файл фактов или null. */
  async latest(): Promise<TokenomicsSnapshot | null> {
    return this.store.loadSnapshot<TokenomicsSnapshot>(TOKENOMICS_SNAPSHOT);
  }

  /** Запускает сбор календаря разлоков по всей вселенной; работа идёт в фоне. */
  async refresh(options: { force?: boolean } = {}): Promise<UniverseRefreshResult> {
    const snapshot = await this.universe.latest();
    if (!snapshot) {
      throw new NotFoundException('Вселенная ещё не собрана. Вызовите POST /universe/refresh');
    }

    const previous = await this.latest();
    const ageMs = previous === null ? null : Date.now() - Date.parse(previous.collectedAt);
    const fresh =
      previous !== null &&
      previous.universeVersion === snapshot.version &&
      ageMs !== null &&
      Number.isFinite(ageMs) &&
      ageMs < REFRESH_TTL_HOURS * 3_600_000;

    if (fresh && options.force !== true) {
      // Сеть не нужна, но пересчитать нужно: после POST /universe/prices
      // изменились circulating, цена и объём, а календарь остался прежним.
      const applied = applyTokenomics(snapshot.candidates, previous);
      await this.universe.saveNumbers({
        candidates: applied.candidates,
        warnings: applied.warnings,
      });
      return {
        started: false,
        reason: 'fresh',
        ageDays: await this.universe.ageDays(),
        message:
          `Календарь собран ${Math.round((ageMs ?? 0) / 3_600_000)} ч назад, в сеть не ходили. ` +
          `Проценты пересчитаны по свежим числам. Принудительно: force=true`,
      };
    }

    return this.universe.runExternalJob(
      'universe/tokenomics',
      'tokenomics',
      'Календарь разлоков',
      (report) => this.collect(snapshot, options.force === true, report),
    );
  }

  /** Один проход: карта, документы совпавших слагов, факты, числа кандидатов. */
  private async collect(
    snapshot: UniverseSnapshot,
    force: boolean,
    report: (event: BuildProgressEvent) => void,
  ): Promise<string> {
    const warnings: string[] = [];
    const total = snapshot.candidates.length;

    report(step('Карта идентификаторов эмиссий', 0, 1, total));
    // Счётчик дописывает report(): в label он давал «1/370 1/370».
    const index = await this.emissions.index(snapshot.version, force, (scanned, all) =>
      report(step('Обход документов эмиссий', scanned, all, total)),
    );
    if (index === null) {
      throw new Error(
        `DeFiLlama не отдал календари. Проверьте ${EMISSIONS_LIST_URL} вручную`,
      );
    }
    if (index.stale === true) {
      warnings.push(
        `КАРТА НЕ ПЕРЕСОБРАНА: ${EMISSIONS_LIST_URL} не ответил, взята карта от ` +
          `${index.builtAt}. Проекты, добавившие календарь после неё, останутся ` +
          'source_missing до следующего успешного force',
      );
    }
    warnings.push(
      `Карта эмиссий ${index.universeVersion}: документов ${index.documents}, ` +
        `монет с идентификатором ${Object.keys(index.byGecko).length}, ` +
        `не отдалось ${index.failed.length}`,
    );

    const hits = new Map<string, string[]>();
    const slugs = new Set<string>();
    const known = new Set(index.slugs);
    for (const candidate of snapshot.candidates) {
      const byGecko = index.byGecko[candidate.coingeckoId] ?? [];
      const bySlug = candidate.defillamaSlugs.filter((slug) => known.has(slug));
      const found = byGecko.length > 0 ? byGecko : bySlug;
      hits.set(candidate.coingeckoId, found);
      if (found.length === 1 && found[0]) slugs.add(found[0]);
    }

    const documents = new Map<string, SlugResult>();
    const list = [...slugs];
    for (const [position, slug] of list.entries()) {
      documents.set(slug, await this.loadSlug(slug));
      report(step('Документы разлоков', position + 1, list.length, total));
    }

    const manual = await this.manual.unlocksByCoingeckoId();
    const facts = snapshot.candidates.map((candidate) =>
      this.factsFor(candidate, hits.get(candidate.coingeckoId) ?? [], documents, manual.get(candidate.coingeckoId) ?? []),
    );

    const applied = applyTokenomics(snapshot.candidates, {
      universeVersion: snapshot.version,
      collectedAt: new Date().toISOString(),
      provider: PROVIDER,
      documentsScanned: index.documents,
      facts,
      warnings,
    });

    warnings.push(
      `Календарь принят: ${applied.calendarCountPct}% по числу, ${applied.calendarMcapPct}% ` +
        `по капитализации. Навес известен у ${applied.overhangCountPct}%`,
      `Состояния: ${Object.entries(applied.byState).map(([key, count]) => `${key} ${count}`).join(' · ')}`,
      ...applied.warnings,
    );

    const stored: TokenomicsSnapshot = {
      universeVersion: snapshot.version,
      collectedAt: new Date().toISOString(),
      provider: PROVIDER,
      documentsScanned: index.documents,
      facts,
      warnings,
    };
    await this.store.saveSnapshot(TOKENOMICS_SNAPSHOT, stored);
    await this.universe.saveNumbers({
      candidates: applied.candidates,
      sources: { tokenomics: EMISSIONS_LIST_URL },
      warnings,
    });

    return (
      `Разлоки собраны: календарь у ${applied.calendarCountPct}% строк ` +
      `(${applied.calendarMcapPct}% капитализации), навес у ${applied.overhangCountPct}%`
    );
  }

  private async loadSlug(slug: string): Promise<SlugResult> {
    const document = await this.emissions.document(slug);
    if (!document.ok || document.data === null) {
      return {
        calendar: null,
        schedulePct: null,
        tbdPct: null,
        pageUrl: document.pageUrl,
        asOf: null,
        error: document.status === null ? `сеть: ${document.error ?? 'нет ответа'}` : `HTTP ${document.status}`,
      };
    }
    // Сырой ответ ложится на диск до всякой обработки, но без двух ветвей,
    // которые не читает никто: documentedData — суточный кумулятивный график,
    // unlockUsdChart — он же в долларах. На них приходится 99% от 4.7 МБ
    // документа AAVE, то есть весь рост data/ при ежедневном прогоне.
    await this.store.saveRaw('defillama-emissions', slug, trimDocument(document.data));

    const nodes = calendarNodes(document.data);
    if (nodes === null) {
      return { calendar: null, schedulePct: null, tbdPct: null, pageUrl: document.pageUrl, asOf: document.asOf, error: null };
    }
    const calendar = parseCalendar(nodes);
    const completeness = completenessOf(document.data, scheduledTotal(calendar));
    return { calendar, ...completeness, pageUrl: document.pageUrl, asOf: document.asOf, error: null };
  }

  private factsFor(
    candidate: UniverseCandidate,
    hits: readonly string[],
    documents: Map<string, SlugResult>,
    manual: readonly ManualUnlockRecord[],
  ): TokenomicsFacts {
    const empty: TokenomicsFacts = {
      coingeckoId: candidate.coingeckoId,
      ticker: candidate.ticker,
      provider: null,
      providerId: null,
      matchedBy: 'none',
      state: 'source_missing',
      events: [],
      streams: [],
      tbdPct: null,
      schedulePct: null,
      includesForecast: false,
      sourceUrl: null,
      asOf: null,
      note: 'источник токен не знает',
    };

    // Два слага на один токен — родитель и версия либо разлок вместе с эмиссией:
    // сложенные, они удваивают разводнение правдоподобно.
    if (hits.length > 1) {
      return this.withManual(
        { ...empty, state: 'mapping_failed', note: `слагов несколько: ${hits.join(', ')}` },
        manual,
      );
    }
    const slug = hits[0];
    if (slug === undefined) return this.withManual(empty, manual);

    const result = documents.get(slug);
    const matched: TokenomicsFacts = {
      ...empty,
      provider: PROVIDER,
      providerId: slug,
      matchedBy: 'coingecko_id',
      sourceUrl: result?.pageUrl ?? null,
      asOf: result?.asOf ?? null,
      note: slug,
    };
    if (result === undefined || result.error !== null) {
      return this.withManual(
        { ...matched, state: 'source_error', note: `${slug}: ${result?.error ?? 'документ не запрашивался'}` },
        manual,
      );
    }
    if (result.calendar === null) {
      return this.withManual(
        { ...matched, state: 'matched_unparsed', note: `${slug}: календаря в документе нет` },
        manual,
      );
    }

    const calendar = result.calendar;
    const nowSec = Math.floor(Date.now() / 1_000);
    const ahead = unlockedIn(calendar, nowSec, nowSec + HORIZON_DAYS.long * DAY_SECONDS);
    // Половина эмиссии без графика — не число с погрешностью, а отказ.
    const gap = result.tbdPct !== null && result.tbdPct > MAX_TBD_PCT;
    const parsed = !calendar.unparsed && !calendar.mismatch && ahead !== null;
    const emptyCalendar = calendar.cliffs.length === 0 && calendar.rates.length === 0;

    const notes = [slug, `расписание ${result.schedulePct ?? '—'}% эмиссии`];
    if (gap) notes.push(`БЕЗ ГРАФИКА ${result.tbdPct}% эмиссии`);
    if (calendar.mismatch) notes.push('итог клиффов разошёлся с summary источника');
    if (calendar.includesForecast) notes.push('включает прогнозную эмиссию');

    if (!parsed || gap || result.tbdPct === null) {
      if (result.tbdPct === null) notes.push('полноту расписания подтвердить нечем');
      return this.withManual({ ...matched, state: 'matched_unparsed', tbdPct: result.tbdPct, schedulePct: result.schedulePct, includesForecast: calendar.includesForecast, note: notes.join(' · ') }, manual);
    }

    const hasFuture = ahead !== null && ahead > 0;
    // Ноль впереди законен, только если эмиссия уже роздана; иначе адаптер отстал.
    const finished =
      (result.schedulePct !== null && result.schedulePct >= SCHEDULE_COMPLETE_PCT) ||
      (candidate.floatPct !== null && candidate.floatPct >= FLOAT_COMPLETE_PCT);
    const state = hasFuture ? 'available' : finished ? 'known_zero' : 'source_stale';

    if (state === 'known_zero') notes.push(`ноль впереди при float ${candidate.floatPct ?? '—'}%`);
    if (state === 'source_stale') notes.push('впереди пусто при незакрытом расписании — адаптер отстал');
    // Числитель от DeFiLlama, знаменатель от CoinGecko: разные учёты.
    if (
      result.schedulePct !== null &&
      result.schedulePct >= SCHEDULE_COMPLETE_PCT &&
      candidate.floatPct !== null &&
      candidate.floatPct < FLOAT_COMPLETE_PCT
    ) {
      notes.push(
        `расписание закрыто на ${result.schedulePct}%, в обращении ${candidate.floatPct}% — разные учёты`,
      );
    }

    const facts: TokenomicsFacts = {
      ...matched,
      state,
      tbdPct: result.tbdPct,
      schedulePct: result.schedulePct,
      includesForecast: calendar.includesForecast,
      note: notes.join(' · '),
      events: futureEvents(calendar, nowSec, matched.sourceUrl ?? '', matched.asOf ?? ''),
      streams: futureStreams(calendar, nowSec, matched.sourceUrl ?? '', matched.asOf ?? ''),
    };
    return this.withManual(facts, manual);
  }

  /**
   * Ручной календарь дополняет провайдера, но не подменяет его. Расхождение
   * более чем вдвое попадает в note, и берётся значение источника.
   */
  private withManual(
    facts: TokenomicsFacts,
    manual: readonly ManualUnlockRecord[],
  ): TokenomicsFacts {
    if (manual.length === 0) return facts;
    const events: UnlockEvent[] = manual.map((record) => ({
      date: record.date,
      tokens: record.tokens,
      category: record.category,
      origin: 'manual',
      sourceUrl: record.sourceUrl,
      asOf: record.asOf,
    }));

    if (facts.state === 'available' || facts.state === 'known_zero') {
      const nowSec = Math.floor(Date.now() / 1_000);
      const horizon = nowSec + HORIZON_DAYS.long * DAY_SECONDS;
      const fromProvider = facts.events
        .filter((e) => inWindow(e.date, nowSec, horizon))
        .reduce((sum, e) => sum + e.tokens, 0);
      const fromManual = events
        .filter((e) => inWindow(e.date, nowSec, horizon))
        .reduce((sum, e) => sum + e.tokens, 0);
      const diverged =
        fromProvider > 0 &&
        fromManual > 0 &&
        (div(fromManual, fromProvider) > MANUAL_CONFLICT_RATIO ||
          div(fromProvider, fromManual) > MANUAL_CONFLICT_RATIO);
      const note = diverged
        ? `${facts.note} · ручной календарь расходится с источником ` +
          `(${round(pctOf(fromManual, fromProvider), 0)}% от его числа) — взято значение источника`
        : `${facts.note} · ручных записей ${events.length}, источник закрывает окно сам`;
      return { ...facts, note };
    }

    const asOf = events.map((event) => event.asOf).sort().at(-1) ?? null;
    return {
      ...facts,
      state: 'available',
      provider: 'manual',
      events,
      streams: [],
      sourceUrl: events[0]?.sourceUrl ?? facts.sourceUrl,
      asOf,
      note: `${facts.note} · ручной календарь: ${events.length} событий, полнота источником не подтверждена`,
    };
  }
}

/** Оставляет то, из чего берутся числа: события, полноту эмиссии и склейку. */
function trimDocument(data: unknown): unknown {
  if (!isRecord(data)) return data;
  const { documentedData: _chart, unlockUsdChart: _usdChart, ...rest } = data;
  return rest;
}

function inWindow(date: string, fromSec: number, toSec: number): boolean {
  const at = Math.floor(Date.parse(date) / 1_000);
  return Number.isFinite(at) && at > fromSec && at <= toSec;
}

/** В файл фактов идёт только будущее: прошлое уже сидит в circulating. */
function futureEvents(
  calendar: ParsedCalendar,
  nowSec: number,
  sourceUrl: string,
  asOf: string,
): UnlockEvent[] {
  return calendar.cliffs
    .filter((event) => event.at > nowSec)
    .sort((left, right) => left.at - right.at)
    .map((event) => ({
      date: new Date(event.at * 1_000).toISOString(),
      tokens: event.tokens,
      category: event.category,
      origin: 'provider' as const,
      sourceUrl,
      asOf,
    }));
}

/**
 * Потоки получателя кладутся группой целиком. Фильтр «сегмент ещё не истёк»
 * выбрасывал уже закончившийся терминатор и воскрешал оборванный им поток.
 */
function futureStreams(
  calendar: ParsedCalendar,
  nowSec: number,
  sourceUrl: string,
  asOf: string,
): UnlockStream[] {
  const byRecipient = new Map<string, RateSegment[]>();
  for (const rate of calendar.rates) {
    byRecipient.set(rate.recipient, [...(byRecipient.get(rate.recipient) ?? []), rate]);
  }

  const kept: RateSegment[] = [];
  for (const group of byRecipient.values()) {
    if (group.some((rate) => rate.ratePerWeek > 0 && rate.end > nowSec)) kept.push(...group);
  }

  return kept.map((rate) => ({
    recipient: rate.recipient,
    category: rate.category,
    startsAt: new Date(rate.at * 1_000).toISOString(),
    endsAt: new Date(rate.end * 1_000).toISOString(),
    tokensPerWeek: rate.ratePerWeek,
    origin: 'provider' as const,
    sourceUrl,
    asOf,
  }));
}

function step(label: string, current: number, total: number, loaded: number): BuildProgressEvent {
  return { step: 'tokenomics', label, current, total, loaded, failed: false, error: null };
}