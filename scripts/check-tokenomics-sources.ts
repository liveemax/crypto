import 'reflect-metadata';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { chunk, isRecord } from '../src/core/fetch/fetch.utils';
import { add, div, mul, pctOf, round, sub } from '../src/core/money';
import { StoreService } from '../src/core/store/store.service';
import { UniverseService } from '../src/core/universe/universe.service';
import type { UniverseCandidate } from '../src/core/universe/universe.types';

/**
 * ШАГ 08 — одноразовый спайк. Доказывает запросами, откуда брать календарь
 * разлоков, и удаляется тем же коммитом, которым парсер переезжает в
 * src/core/tokenomics/. Ничего не пишет в data/ кроме сырых ответов.
 */

const STALE_DAYS = 7;
const REPORT_PATH = join('reports', 'step-08-tokenomics-sources.md');
const LLAMA_LIST_URLS = [
  'https://defillama-datasets.llama.fi/emissionsProtocolsList',
  'https://api.llama.fi/emissions',
];
const LLAMA_SCHEDULE_URLS = [
  (slug: string) => `https://defillama-datasets.llama.fi/emissions/${encodeURIComponent(slug)}`,
  (slug: string) => `https://api.llama.fi/emission/${encodeURIComponent(slug)}`,
];
const LLAMA_PAGE = (slug: string): string => `https://defillama.com/unlocks/${slug}`;
const MOBULA_HOSTS = ['https://api.mobula.io', 'https://production-api.mobula.io'];
const BULK_SIZES = [5, 25, 50, 100];
/** Одновременных запросов к датасету: 370 документов, CDN без лимита — но топить его незачем. */
const POOL = 6;
/** Попыток на запрос. Повторяются 429, 5xx и сетевой сбой; 401, 402 и 404 — нет. */
const ATTEMPTS = 4;
const EVM_CONTRACT = /^0x[a-fA-F0-9]{40}$/;
/** CoinGecko называет сети по-своему, Mobula v2 требует chainId. Только проверенное. */
const CHAIN_IDS: Record<string, string> = {
  ethereum: 'evm:1',
  'binance-smart-chain': 'evm:56',
  'polygon-pos': 'evm:137',
  'arbitrum-one': 'evm:42161',
  'optimistic-ethereum': 'evm:10',
  base: 'evm:8453',
  avalanche: 'evm:43114',
};
const MOBULA_V2 = 'https://api.mobula.io/api/2/token/details';
const DATE_KEY = /(date|timestamp|time|start|end)/i;
const AMOUNT_KEY = /(amount|tokens|quantity|unlock|value)/i;

interface Options {
  limit: number;
  must: string[];
  full: boolean;
  contracts: boolean;
  /** Mobula измерена и прироста не дала: по умолчанию не опрашивается. */
  mobula: boolean;
}

interface Probe {
  label: string;
  url: string;
  status: number | null;
  ok: boolean;
  error: string | null;
  ms: number;
  bytes: number;
  /** Время источника из заголовков: у датасета без даты внутри это единственный asOf. */
  sourceDate: string | null;
  rateLimit: string | null;
  data: unknown;
  /** Сколько попыток понадобилось: ответ с четвёртой — не то же, что с первой. */
  attempts: number;
}

type MatchState =
  | 'exact'
  | 'mapping_failed'
  | 'source_missing'
  | 'source_stale'
  /** Документ найден, сумма события не разобрана: отказ, а не ноль. */
  | 'matched_unparsed';

interface Match {
  candidate: UniverseCandidate;
  state: MatchState;
  matchedBy: 'coingecko_id' | 'contract' | 'provider_id' | 'symbol' | 'none';
  /** Слаг источника: по нему догружается документ во втором проходе. */
  slug?: string;
  /** Токенов к разлоку за 365 дней вперёд; null — календарь не разобран. */
  tokens365?: number | null;
  /** Разводнение за 12 месяцев в процентах circulating. */
  dilution12mPct?: number | null;
  events: number;
  future: number;
  nextAt: string | null;
  sourceUrl: string | null;
  asOf: string | null;
  note: string;
}

interface RawEvent {
  dateIso: string;
  tokens: number | null;
}

function parseArgs(argv: string[]): Options {
  const value = (name: string): string | null => {
    const found = argv.find((item) => item.startsWith(`--${name}=`));
    return found ? found.slice(name.length + 3) : null;
  };
  const limit = Number(value('limit') ?? 40);
  return {
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 40,
    must: (value('must') ?? 'HYPE,AAVE,ARB,OP').split(',').map((item) => item.trim().toUpperCase()),
    full: argv.includes('--full'),
    contracts: !argv.includes('--no-contracts'),
    mobula: argv.includes('--mobula'),
  };
}

/** Запрос со своим клиентом: спайк меряет то, что fetchJson прячет — заголовки, размер, время. */
async function probe(
  label: string,
  url: string,
  headers: Record<string, string> = {},
): Promise<Probe> {
  const started = Date.now();
  let last: Probe = {
    label, url: mask(url), status: null, ok: false, error: 'Запрос не выполнялся',
    ms: 0, bytes: 0, sourceDate: null, rateLimit: null, data: null, attempts: 0,
  };

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: {
          accept: 'application/json',
          'user-agent': 'crypto-agents/0.1 (research spike)',
          ...headers,
        },
      });
      const text = await response.text();
      const retryAfter = response.headers.get('retry-after');
      const limits = ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']
        .map((name) => (response.headers.get(name) ? `${name}=${response.headers.get(name)}` : null))
        .filter((item): item is string => item !== null);

      last = {
        label,
        url: mask(url),
        status: response.status,
        ok: response.ok,
        error: response.ok ? null : `HTTP ${response.status} ${response.statusText}: ${text.slice(0, 200)}`,
        ms: Date.now() - started,
        bytes: Buffer.byteLength(text),
        sourceDate: response.headers.get('last-modified') ?? response.headers.get('date'),
        rateLimit: [retryAfter ? `retry-after=${retryAfter}` : null, ...limits]
          .filter((item): item is string => item !== null)
          .join(' ') || null,
        data: response.ok ? safeJson(text) : null,
        attempts: attempt + 1,
      };

      // 401, 402 и 404 повтором не лечатся: ключ не появится, путь не возникнет.
      const retriable = response.status === 429 || response.status >= 500;
      if (!retriable || attempt === ATTEMPTS - 1) return last;
      await delay(backoffMs(retryAfter, attempt));
    } catch (error: unknown) {
      last = {
        ...last,
        status: null,
        ok: false,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
        attempts: attempt + 1,
      };
      // Обрыв соединения и таймаут — не ответ источника, они повторяются.
      if (attempt === ATTEMPTS - 1) return last;
      await delay(backoffMs(null, attempt));
    }
  }
  return last;
}

/** Пауза перед повтором: её называет источник, своя формула — только когда он молчит. */
function backoffMs(retryAfter: string | null, attempt: number): number {
  const asked = Number(retryAfter);
  const own = 2 ** attempt * 1000;
  const wait = Number.isFinite(asked) && asked > 0 ? asked * 1000 : own;
  return Math.min(Math.max(wait, own), 20_000);
}

/** Ключи в URL не попадают ни в отчёт, ни в лог, ни тем более в sourceUrl. */
function mask(url: string): string {
  return url.replace(/(pro-api\.llama\.fi\/)[^/]+/, '$1***');
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Компактная схема ответа: ключ → тип, два уровня вглубь. */
function schemaOf(value: unknown, depth = 2): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array(пусто)';
    return `array[${value.length}] of ${depth > 0 ? schemaOf(value[0], depth - 1) : 'object'}`;
  }
  if (isRecord(value)) {
    if (depth <= 0) return 'object';
    const parts = Object.entries(value)
      .slice(0, 24)
      .map(([key, item]) => `${key}: ${schemaOf(item, depth - 1)}`);
    return `{ ${parts.join(', ')} }`;
  }
  return value === null ? 'null' : typeof value;
}

function toIso(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1e8) {
    const date = new Date(value > 1e12 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  return null;
}

/** Количество токенов события: число либо массив чисел — noOfTokens у DeFiLlama массив. */
function amountOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    const numbers = value.filter(
      (item): item is number => typeof item === 'number' && Number.isFinite(item),
    );
    return numbers.length > 0 ? numbers.reduce((sum, item) => add(sum, item), 0) : null;
  }
  return null;
}

/**
 * Событие календаря DeFiLlama: количество лежит в amount внутри аллокации,
 * уровнем ниже даты. Аллокация без числа делает сумму события неизвестной
 * целиком — «часть неизвестна» и «часть равна нулю» это разные утверждения.
 */
const WEEK_SECONDS = 604_800;

/** Смена ставки линейного разлока: действует до своего конца или до следующей. */
interface RateChange {
  recipient: string;
  at: number;
  end: number;
  ratePerWeek: number;
}

interface Calendar {
  cliffs: RawEvent[];
  rates: RateChange[];
  /** Хоть одна аллокация без разбираемого числа — отказ по всему токену. */
  unparsed: boolean;
  /** Свой итог клиффа разошёлся с итогом источника: признак двойного учёта. */
  mismatch: boolean;
  /** Поток помечен источником как прогноз: это эмиссия, а не вестинг. */
  forecast: boolean;
}

/**
 * Разбирает календарь. Клифф несёт количество, линейная аллокация — ставку в
 * неделю: сложить их как однородные события значит посчитать четырёхлетний
 * вестинг одним днём.
 */
function parseCalendar(nodes: readonly unknown[]): Calendar {
  const cliffs: RawEvent[] = [];
  const rates: RateChange[] = [];
  let unparsed = false;
  let mismatch = false;
  let forecast = false;

  for (const node of nodes) {
    if (!isRecord(node)) continue;
    const at = typeof node.timestamp === 'number' ? node.timestamp : null;
    const dateIso = toIso(node.timestamp);
    if (at === null || dateIso === null) continue;

    let cliff: number | null = null;
    if (Array.isArray(node.cliffAllocations)) {
      for (const allocation of node.cliffAllocations) {
        const amount = isRecord(allocation) ? amountOf(allocation.amount) : null;
        if (amount === null) {
          unparsed = true;
          continue;
        }
        cliff = add(cliff ?? 0, amount);
      }
    }
    const declared = isRecord(node.summary) ? amountOf(node.summary.totalTokensCliff) : null;
    if (cliff !== null && declared !== null && declared > 0) {
      if (Math.abs(pctOf(sub(cliff, declared), declared)) > 0.5) mismatch = true;
    }
    if (cliff !== null && cliff > 0) cliffs.push({ dateIso, tokens: cliff });

    if (Array.isArray(node.linearAllocations)) {
      for (const allocation of node.linearAllocations) {
        if (!isRecord(allocation)) continue;
        const ratePerWeek = amountOf(allocation.newRatePerWeek);
        const end = typeof allocation.endTimestamp === 'number' ? allocation.endTimestamp : null;
        if (ratePerWeek === null || end === null) {
          unparsed = true;
          continue;
        }
        const recipient =
          typeof allocation.recipient === 'string' ? allocation.recipient : 'unknown';
        if (/forecast/i.test(recipient)) forecast = true;
        rates.push({ recipient, at, end, ratePerWeek });
      }
    }
  }
  return { cliffs, rates, unparsed, mismatch, forecast };
}

/** Токенов, разлоченных в окне: клиффы внутри него плюс интеграл ставок. */
function unlockedIn(calendar: Calendar, from: number, to: number): number | null {
  if (calendar.unparsed || calendar.mismatch) return null;
  let total = 0;

  for (const event of calendar.cliffs) {
    if (event.tokens === null) return null;
    const at = Math.floor(Date.parse(event.dateIso) / 1000);
    if (at > from && at <= to) total = add(total, event.tokens);
  }

  const byRecipient = new Map<string, RateChange[]>();
  for (const rate of calendar.rates) {
    byRecipient.set(rate.recipient, [...(byRecipient.get(rate.recipient) ?? []), rate]);
  }
  for (const list of byRecipient.values()) {
    const sorted = [...list].sort((left, right) => left.at - right.at);
    for (const [index, segment] of sorted.entries()) {
      // Следующая смена ставки обрывает предыдущую: иначе потоки складываются
      // сами с собой и разводнение удваивается правдоподобно.
      const next = sorted[index + 1];
      const segmentEnd = Math.min(segment.end, next?.at ?? segment.end);
      const start = Math.max(segment.at, from);
      const finish = Math.min(segmentEnd, to);
      if (finish > start) {
        total = add(total, mul(div(segment.ratePerWeek, WEEK_SECONDS), sub(finish, start)));
      }
    }
  }
  return round(total, 2);
}

/**
 * Доля эмиссии, покрытая расписанием. Дата файла — время перегенерации, а не
 * время данных; календарь, который месяц никто не правил, выглядит просроченным
 * именно потому, что он верен. Обрыв расписания ниже всей эмиссии — вот признак
 * отставшего адаптера.
 */
/** Доля эмиссии без расписания, выше которой число не принимается. */
const MAX_TBD_PCT = 5;

/**
 * Навес: на сколько процентов обращения вырастет предложение, если выпустят всё.
 * Считается из снимка вселенной, не зависит от чужих адаптеров и потому известен
 * почти у всех. Навес говорит сколько, календарь — когда.
 */
function overhangOf(candidate: UniverseCandidate): number | null {
  const { circulating, totalSupply } = candidate;
  if (circulating === null || totalSupply === null || circulating <= 0) return null;
  // totalSupply ниже circulating — рассогласование источника, а не отрицательный
  // навес: ноль здесь означал бы «выпускать нечего», чего мы не измеряли.
  if (totalSupply < circulating) return null;
  return round(pctOf(sub(totalSupply, circulating), circulating), 2);
}

/**
 * Полнота расписания. Знаменатель — maxSupply: adjustedSupply это эмиссия,
 * у которой график есть, и деление на неё завышало ровно на долю пробела —
 * 100% клиффов EDGE при 35% пробела давали 154%.
 */
function completenessOf(
  data: unknown,
  scheduled: number | null,
): { supply: number | null; pct: number | null; tbdPct: number | null } {
  const metrics = isRecord(data) ? data.supplyMetrics : null;
  const supply = isRecord(metrics) ? amountOf(metrics.maxSupply) : null;
  const tbd = isRecord(metrics) ? amountOf(metrics.tbdAmount) : null;
  return {
    supply,
    pct:
      scheduled !== null && supply !== null && supply > 0
        ? round(pctOf(scheduled, supply), 2)
        : null,
    // Отрицательный tbd — округление источника, а не отрицательный пробел.
    tbdPct:
      tbd !== null && supply !== null && supply > 0
        ? round(Math.max(pctOf(tbd, supply), 0), 2)
        : null,
  };
}
/** Находит поддерево с календарём по имени поля: схема источника заранее неизвестна. */
function findScheduleNode(
  node: unknown,
  path = '',
  depth = 5,
): { path: string; value: unknown } | null {
  if (depth < 0) return null;
  if (Array.isArray(node)) {
    for (const [index, item] of node.slice(0, 5).entries()) {
      const found = findScheduleNode(item, `${path}[${index}]`, depth - 1);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(node)) return null;
  for (const [key, value] of Object.entries(node)) {
    if (
      /release|schedule|unlock|vesting|emission/i.test(key) &&
      (Array.isArray(value) || isRecord(value))
    ) {
      return { path: `${path}.${key}`, value };
    }
  }
  for (const [key, value] of Object.entries(node)) {
    const found = findScheduleNode(value, `${path}.${key}`, depth - 1);
    if (found) return found;
  }
  return null;
}

/** Ищет события «дата + количество» независимо от имени поля: схема источника неизвестна. */
function collectEvents(node: unknown, out: RawEvent[], depth = 5): void {
  if (out.length >= 5000 || depth < 0) return;
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 3000)) collectEvents(item, out, depth - 1);
    return;
  }
  if (!isRecord(node)) return;

  const dateKey = Object.keys(node).find((key) => DATE_KEY.test(key) && toIso(node[key]) !== null);
  const amountKey = Object.keys(node).find(
    (key) => AMOUNT_KEY.test(key) && amountOf(node[key]) !== null,
  );
  if (dateKey) {
    const dateIso = toIso(node[dateKey]);
    const tokens = amountKey ? amountOf(node[amountKey]) : null;
    if (dateIso) out.push({ dateIso, tokens });
  }
  for (const item of Object.values(node)) {
    if (Array.isArray(item) || isRecord(item)) collectEvents(item, out, depth - 1);
  }
}

/** Явные метки типа графика: cliff и linear должны быть показаны обе. */
function collectKinds(node: unknown, out: Set<string>, depth = 5): void {
  if (depth < 0) return;
  if (typeof node === 'string') {
    const value = node.toLowerCase();
    if (value === 'cliff' || value === 'linear') out.add(value);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 3000)) collectKinds(item, out, depth - 1);
    return;
  }
  if (isRecord(node)) for (const item of Object.values(node)) collectKinds(item, out, depth - 1);
}

function collectContracts(node: unknown, out: Set<string>, depth = 4): void {
  if (depth < 0) return;
  if (typeof node === 'string') {
    if (EVM_CONTRACT.test(node)) out.add(node.toLowerCase());
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 200)) collectContracts(item, out, depth - 1);
    return;
  }
  if (isRecord(node)) for (const item of Object.values(node)) collectContracts(item, out, depth - 1);
}

function sumMcap(items: readonly UniverseCandidate[]): number {
  return items.reduce((sum, item) => (item.mcapCalcUsd === null ? sum : add(sum, item.mcapCalcUsd)), 0);
}

function coverageOf(
  matched: readonly UniverseCandidate[],
  all: readonly UniverseCandidate[],
): { countPct: number; mcapPct: number; matched: number; total: number } {
  const totalMcap = sumMcap(all);
  return {
    matched: matched.length,
    total: all.length,
    countPct: all.length > 0 ? round(pctOf(matched.length, all.length), 2) : 0,
    mcapPct: totalMcap > 0 ? round(pctOf(sumMcap(matched), totalMcap), 2) : 0,
  };
}

/** Пороги зафиксированы ТЗ до реализации: решение не подгоняется под результат. */
function scenarioOf(mcapPct: number): string {
  if (mcapPct >= 60) {
    return 'A (≥60% капитализации): источник основной, шаг 09 пишется по нему';
  }
  if (mcapPct >= 20) {
    return 'B (20–60%): источник основной, но шаг 09 обязан включить ручной слой ' +
      'POST /manual/unlocks, а GET /universe/data-gaps становится рабочей очередью';
  }
  return 'C (<20%): автоматический источник не принимается; ручной слой плюс ' +
    'floatPct/fdvToMcap, вес tokenomics пересматривается явной правкой профиля';
}

function verdictOf(probe: Probe): string {
  if (probe.status === null) return 'сетевая ошибка или таймаут';
  if (probe.status === 401) return '401 — нужен ключ';
  if (probe.status === 402) return '402 — только платный тариф';
  if (probe.status === 429) return '429 — упёрлись в лимит запросов';
  if (probe.status === 404) return '404 — такого пути нет';
  return probe.ok ? 'ответ получен' : `HTTP ${probe.status}`;
}

function isStale(sourceDate: string | null): boolean {
  if (sourceDate === null) return false;
  const parsed = Date.parse(sourceDate);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed > STALE_DAYS * 86_400_000;
}

interface LlamaIndex {
  byGecko: Map<string, string[]>;
  byContract: Map<string, string[]>;
  slugs: Set<string>;
}

interface ScheduleOut {
  kinds: Set<string>;
  schema: string | null;
  sample: string | null;
  /** Схема линейной аллокации: главный невыясненный вопрос источника. */
  linear: string | null;
}

/** Ограниченная параллельность: 370 документов без залпа в 370 сокетов. */
async function mapWithPool<T, R>(
  items: readonly T[],
  size: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await run(item);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Идентификаторы токена внутри документа: coingecko id главный, контракт запасной. */
function identifiersOf(
  node: unknown,
  out: { gecko: Set<string>; contracts: Set<string> },
  depth = 6,
): void {
  if (depth < 0) return;
  if (typeof node === 'string') {
    if (node.startsWith('coingecko:')) out.gecko.add(node.slice('coingecko:'.length).toLowerCase());
    else if (EVM_CONTRACT.test(node)) out.contracts.add(node.toLowerCase());
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 500)) identifiersOf(item, out, depth - 1);
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && /^(gecko_id|geckoId|coingeckoId)$/i.test(key)) {
      out.gecko.add(value.toLowerCase());
      continue;
    }
    identifiersOf(value, out, depth - 1);
  }
}

/** Склейка с календарём: coingecko id, затем контракт, затем слаг протокола. */
function matchLlama(
  candidate: UniverseCandidate,
  index: LlamaIndex,
  contractsById: Map<string, Set<string>>,
): Match {
  const base = { candidate, events: 0, future: 0, nextAt: null, sourceUrl: null, asOf: null };
  const byGecko = index.byGecko.get(candidate.coingeckoId) ?? [];
  const ours = contractsById.get(candidate.coingeckoId) ?? new Set<string>();
  const byContract = [
    ...new Set([...ours].flatMap((address) => index.byContract.get(address) ?? [])),
  ];
  const bySlug = candidate.defillamaSlugs.filter((slug) => index.slugs.has(slug));

  const hits = byGecko.length > 0 ? byGecko : byContract.length > 0 ? byContract : bySlug;
  if (hits.length === 0) {
    return { ...base, state: 'source_missing', matchedBy: 'none', note: 'источник токен не знает' };
  }
  const matchedBy: Match['matchedBy'] =
    byGecko.length > 0 ? 'coingecko_id' : byContract.length > 0 ? 'contract' : 'provider_id';
  // Два слага на один токен — родитель и версия либо разлок вместе с эмиссией:
  // сложенные, они удваивают разводнение правдоподобно.
  if (hits.length > 1) {
    return { ...base, state: 'mapping_failed', matchedBy, note: `слагов несколько: ${hits.join(', ')}` };
  }
  return { ...base, state: 'exact', matchedBy, slug: hits[0], note: hits[0] ?? '' };
}

/** Догружает документ слага: сырой ответ ложится на диск до разбора событий. */
async function loadSchedule(
  match: Match,
  store: StoreService,
  probes: Probe[],
  out: ScheduleOut,
): Promise<Match> {
  if (match.slug === undefined) return match;
  for (const build of LLAMA_SCHEDULE_URLS) {
    const result = await probe(`defillama/${match.slug}`, build(match.slug));
    if (!result.ok || result.data === null) continue;
    probes.push(result);
    await store.saveRaw('defillama-emissions', match.slug, result.data);
    collectKinds(result.data, out.kinds);

    // Календарь лежит в metadata.unlockEvents. documentedData.data — суточный
    // кумулятивный график: сложив его точки, мы посчитали бы одни и те же токены
    // столько раз, сколько дней они уже разлочены.
    const metadata = isRecord(result.data) ? result.data.metadata : null;
    const raw = isRecord(metadata)
      ? Array.isArray(metadata.unlockEvents)
        ? metadata.unlockEvents
        : metadata.events
      : null;
    const calendar = Array.isArray(raw) ? raw : null;
    if (out.schema === null && calendar !== null && calendar.length > 0) {
      out.schema = schemaOf(calendar[0]);
      out.sample = JSON.stringify(calendar.slice(0, 3)).slice(0, 1500);
    }
    // Если у линейной аллокации свой период, её amount — итог за срок, а не
    // событие дня, и сумма за год завышена у всех, кто её содержит.
    if (out.linear === null && calendar !== null) {
      for (const item of calendar) {
        const group = isRecord(item) ? item.linearAllocations : null;
        if (Array.isArray(group) && group.length > 0) {
          out.linear = `${schemaOf(group[0])} · ${JSON.stringify(group[0]).slice(0, 400)}`;
          break;
        }
      }
    }

    const parsed = calendar !== null ? parseCalendar(calendar) : null;
    const nowSec = Math.floor(Date.now() / 1000);
    const horizonSec = nowSec + 365 * 86_400;

    const events: RawEvent[] = parsed
      ? [
          ...parsed.cliffs,
          ...parsed.rates.map((rate) => ({
            dateIso: new Date(rate.at * 1000).toISOString(),
            tokens: null,
          })),
        ]
      : [];
    // Документ другой формы: эвристика как запасной путь, с пометкой в отчёте.
    if (parsed === null) collectEvents(result.data, events, 3);

    const summary = summarize(events);
    const tokens365 = parsed ? unlockedIn(parsed, nowSec, horizonSec) : null;
    const scheduled = parsed ? unlockedIn(parsed, 0, Number.MAX_SAFE_INTEGER) : null;
    const complete = completenessOf(result.data, scheduled);
    const circulating = match.candidate.circulating;
    const floatPct = match.candidate.floatPct;

    // Половина эмиссии без графика — не число с погрешностью, а отказ: у HYPE
    // расписание описывает 37.8% выпуска, и разводнение по нему ничего не значит.
    const gap = complete.tbdPct !== null && complete.tbdPct > MAX_TBD_PCT;
    // Ноль впереди законен, только если эмиссия уже роздана: расписание покрыло
    // её целиком либо она и так в обращении. Иначе адаптер просто отстал.
    const finished =
      (complete.pct !== null && complete.pct >= 99) || (floatPct !== null && floatPct >= 90);
    const hasFuture = summary.future > 0 || (tokens365 !== null && tokens365 > 0);
    const empty = parsed !== null && parsed.cliffs.length === 0 && parsed.rates.length === 0;
    const state: MatchState =
      tokens365 === null || empty || gap
        ? 'matched_unparsed'
        : hasFuture || finished
          ? 'exact'
          : 'source_stale';
    const usable = state === 'exact' ? tokens365 : null;

    return {
      ...match,
      state,
      events: summary.total,
      future: summary.future,
      nextAt: summary.nextAt,
      tokens365: usable,
      dilution12mPct:
        usable !== null && circulating !== null && circulating > 0
          ? round(pctOf(usable, circulating), 2)
          : null,
      sourceUrl: LLAMA_PAGE(match.slug),
      asOf: result.sourceDate,
      note:
        `${match.slug} · расписание ${complete.pct ?? '—'}% эмиссии` +
        (gap ? ` · БЕЗ ГРАФИКА ${complete.tbdPct}% эмиссии` : '') +
        (state === 'exact' && !hasFuture ? ` · ноль при float ${floatPct ?? '—'}%` : '') +
        (parsed?.forecast === true ? ' · включает прогнозную эмиссию' : '') +
        (parsed?.mismatch === true ? ' · итог клиффа разошёлся с источником' : ''),
    };
  }
  return { ...match, state: 'source_missing', note: `${match.slug}: документ не отдан` };
}

function pickSample(selection: UniverseCandidate[], options: Options): UniverseCandidate[] {
  const byMcap = [...selection].sort((left, right) => (right.mcapCalcUsd ?? -1) - (left.mcapCalcUsd ?? -1));
  const must = byMcap.filter((item) => options.must.includes(item.ticker));
  const rest = byMcap.filter((item) => !options.must.includes(item.ticker));
  return [...must, ...rest].slice(0, Math.max(options.limit, must.length));
}

/** Тикер не идентификатор: символ, встреченный дважды, — отказ, а не выбор большего. */
function collisionsOf(selection: readonly UniverseCandidate[]): Set<string> {
  const counts = new Map<string, number>();
  for (const item of selection) counts.set(item.ticker, (counts.get(item.ticker) ?? 0) + 1);
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([ticker]) => ticker));
}

function summarize(events: RawEvent[]): { total: number; future: number; nextAt: string | null } {
  const now = Date.now();
  const future = events
    .filter((item) => Date.parse(item.dateIso) > now && (item.tokens === null || item.tokens > 0))
    .sort((left, right) => Date.parse(left.dateIso) - Date.parse(right.dateIso));
  return { total: events.length, future: future.length, nextAt: future[0]?.dateIso ?? null };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const lines: string[] = [];
  const probes: Probe[] = [];

  try {
    const universe = app.get(UniverseService);
    const store = app.get(StoreService);

    const snapshot = await universe.latest();
    if (!snapshot) throw new Error('Снимка вселенной нет. Сначала POST /universe/refresh');
    const status = await universe.status();
    const selection = await universe.passed();
    if (selection.length === 0) {
      throw new Error('Active selection пуста. Проверьте GET /universe/status');
    }

    const sample = pickSample(selection, options);
    const collisions = collisionsOf(selection);
    const missingMust = options.must.filter((ticker) => !selection.some((item) => item.ticker === ticker));
    // ТЗ требует показать схему на AAVE и ARB, а screen с alpha их вырезали.
    // Берутся из снимка как контроль и в покрытие не засчитываются.
    const controls = snapshot.candidates.filter(
      (item) =>
        options.must.includes(item.ticker) &&
        !selection.some((chosen) => chosen.coingeckoId === item.coingeckoId),
    );

    const overhangById = new Map<string, number | null>();
    for (const item of [...selection, ...controls]) {
      overhangById.set(item.coingeckoId, overhangOf(item));
    }
    const withOverhang = selection.filter(
      (item) => (overhangById.get(item.coingeckoId) ?? null) !== null,
    );

    lines.push('# ШАГ 08 — источник разлоков: что ответили источники');
    lines.push('');
    lines.push(`Прогон: ${new Date().toISOString()}`);
    lines.push(`universeVersion: ${snapshot.version} · builtAt: ${snapshot.builtAt}`);
    lines.push(`activeFilters: \`${JSON.stringify(status.activeFilters)}\``);
    lines.push(`Active selection: ${selection.length} · выборка спайка: ${sample.length}`);
    lines.push(
      `Обязательных тикеров нет в active selection: ${missingMust.join(', ') || 'нет'}. ` +
        `Взяты из снимка как контроль: ${controls.map((item) => item.ticker).join(', ') || 'нет'}`,
    );
    lines.push(`Коллизии тикеров внутри active selection: ${[...collisions].join(', ') || 'нет'}`);
    lines.push('');

    // ── Контракты для точной склейки: один bulk-вызов CoinGecko, не по монете.
    const contractsById = new Map<string, Set<string>>();
    // Имя сети выбрасывать нельзя: Mobula v2 адресуется парой chainId + address.
    const tokensById = new Map<string, { chainId: string; address: string }[]>();
    if (options.contracts) {
      const key = process.env.COINGECKO_API_KEY;
      const listProbe = await probe(
        'coingecko/coins-list',
        'https://api.coingecko.com/api/v3/coins/list?include_platform=true',
        key ? { 'x-cg-demo-api-key': key } : {},
      );
      probes.push(listProbe);
      if (listProbe.ok && Array.isArray(listProbe.data)) {
        await store.saveRaw('coingecko-coins-list', 'include-platform', listProbe.data);
        for (const row of listProbe.data) {
          if (!isRecord(row) || typeof row.id !== 'string') continue;
          const found = new Set<string>();
          collectContracts(row.platforms, found);
          if (found.size > 0) contractsById.set(row.id, found);
          if (isRecord(row.platforms)) {
            const tokens = Object.entries(row.platforms)
              .map(([platform, address]) => ({
                chainId: CHAIN_IDS[platform] ?? null,
                address: typeof address === 'string' ? address.toLowerCase() : null,
              }))
              .filter(
                (item): item is { chainId: string; address: string } =>
                  item.chainId !== null && item.address !== null && EVM_CONTRACT.test(item.address),
              );
            if (tokens.length > 0) tokensById.set(row.id, tokens);
          }
        }
      }
    }

    // ── Кандидат 1: публичные emissions-датасеты DeFiLlama, склейка по coingecko id.
    lines.push('## DeFiLlama emissions (без ключа)');
    lines.push('');
    let llamaList: unknown = null;
    for (const url of LLAMA_LIST_URLS) {
      const result = await probe('defillama/list', url);
      probes.push(result);
      if (result.ok && result.data !== null) {
        await store.saveRaw('defillama-emissions', 'protocols-list', result.data);
        llamaList = result.data;
        lines.push(`Список: ${result.url} → ${result.status}, ${result.bytes} байт, ${result.ms} мс`);
        lines.push(`Схема списка: \`${schemaOf(llamaList)}\``);
        lines.push(`Дата источника (last-modified): ${result.sourceDate ?? 'заголовка нет'}`);
        break;
      }
      lines.push(`Список: ${result.url} → ${verdictOf(result)}`);
    }
    lines.push('');

    const llamaMatches: Match[] = [];
    let llamaCoverage = coverageOf([], selection);
    if (llamaList !== null) {
      const slugs = (Array.isArray(llamaList) ? llamaList : []).filter(
        (item): item is string => typeof item === 'string',
      );
      lines.push(`Проектов с календарём: ${slugs.length}`);

      // Первый проход. Список отдаёт только слаги, идентификатор токена лежит
      // внутри документа. Тела не сохраняются и ни одно число из них в отчёт не
      // идёт: меряется принадлежность слага, а не метрика актива.
      const scanned = await mapWithPool(slugs, POOL, async (slug) => {
        for (const build of LLAMA_SCHEDULE_URLS) {
          const result = await probe(`defillama/${slug}`, build(slug));
          if (!result.ok || result.data === null) continue;
          const found = { gecko: new Set<string>(), contracts: new Set<string>() };
          identifiersOf(result.data, found);
          return {
            slug,
            ok: true,
            gecko: [...found.gecko],
            contracts: [...found.contracts],
            bytes: result.bytes,
          };
        }
        return { slug, ok: false, gecko: [] as string[], contracts: [] as string[], bytes: 0 };
      });

      const loaded = scanned.filter((item) => item.ok);
      const weight = loaded.reduce((sum, item) => sum + item.bytes, 0);
      lines.push(
        `Документов загружено: ${loaded.length} из ${slugs.length}, суммарно ${weight} байт — ` +
          'столько весит один прогон POST /universe/tokenomics',
      );

      const index: LlamaIndex = {
        byGecko: new Map<string, string[]>(),
        byContract: new Map<string, string[]>(),
        slugs: new Set(loaded.map((item) => item.slug)),
      };
      for (const item of loaded) {
        for (const id of item.gecko) {
          index.byGecko.set(id, [...(index.byGecko.get(id) ?? []), item.slug]);
        }
        for (const address of item.contracts) {
          index.byContract.set(address, [...(index.byContract.get(address) ?? []), item.slug]);
        }
      }
      lines.push(
        `Уникальных coingecko id в документах: ${index.byGecko.size}, ` +
          `EVM-контрактов: ${index.byContract.size}`,
      );
      lines.push('');

      for (const candidate of selection) {
        llamaMatches.push(matchLlama(candidate, index, contractsById));
      }
      const covered = llamaMatches
        .filter((item) => item.state === 'exact')
        .map((item) => item.candidate);
      llamaCoverage = coverageOf(covered, selection);
      lines.push(
        `Покрытие active selection: ${llamaCoverage.matched}/${llamaCoverage.total} = ` +
          `${llamaCoverage.countPct}% по числу, ${llamaCoverage.mcapPct}% по капитализации. ` +
          'Считается по совпадению идентификатора; наличие событий проверено на выборке и контроле',
      );
      const states = new Map<MatchState, number>();
      for (const item of llamaMatches) states.set(item.state, (states.get(item.state) ?? 0) + 1);
      lines.push(
        `Состояния: ${[...states.entries()].map(([key, count]) => `${key} ${count}`).join(' · ')}`,
      );
      lines.push('');

      // Второй проход: все совпавшие, а не только выборка. 76 документов и есть
      // настоящая цена ответа на вопрос «у скольких посчитано разводнение».
      const out: ScheduleOut = {
        kinds: new Set<string>(),
        schema: null,
        sample: null,
        linear: null,
      };
      const detailed: Match[] = [];
      for (const match of llamaMatches.filter((item) => item.state === 'exact')) {
        detailed.push(await loadSchedule(match, store, probes, out));
      }
      for (const candidate of controls) {
        detailed.push(
          await loadSchedule(matchLlama(candidate, index, contractsById), store, probes, out),
        );
      }

      lines.push(`Схема документа: \`${out.schema ?? 'ни один документ выборки не загрузился'}\``);
      lines.push(
        `Схема linearAllocations: \`${out.linear ?? 'линейных аллокаций в выборке не встретилось'}\``,
      );
      lines.push(`Явные типы графиков: ${[...out.kinds].join(', ') || 'меток cliff/linear в теле нет'}`);
      if (out.sample !== null) {
        lines.push('');
        lines.push('```json');
        lines.push(out.sample);
        lines.push('```');
      }
      lines.push('');
      const inSelection = detailed.filter((item) =>
        selection.some((chosen) => chosen.coingeckoId === item.candidate.coingeckoId),
      );
      const withNumber = inSelection.filter(
        (item) => item.dilution12mPct !== null && item.dilution12mPct !== undefined,
      );
      const fresh = withNumber.filter((item) => item.state !== 'source_stale');
      const numbers = coverageOf(withNumber.map((item) => item.candidate), selection);
      const freshOnly = coverageOf(fresh.map((item) => item.candidate), selection);
      const nonZero = withNumber.filter((item) => (item.dilution12mPct ?? 0) > 0);
      const nonZeroCoverage = coverageOf(nonZero.map((item) => item.candidate), selection);
      lines.push('### Итог: у скольких посчитано разводнение и годовая эмиссия');
      lines.push(
        `Разводнение больше нуля — единственное, что действительно измерено: ` +
          `${nonZeroCoverage.matched}/${nonZeroCoverage.total} = ${nonZeroCoverage.countPct}% ` +
          `по числу, ${nonZeroCoverage.mcapPct}% по капитализации`,
      );
      lines.push(
        `Календарь разобран, число получено (включая нули): ${numbers.matched}/${numbers.total} = ` +
          `${numbers.countPct}% по числу, ${numbers.mcapPct}% по капитализации`,
      );
      lines.push(
        `Из них документ свежее ${STALE_DAYS} дней: ${freshOnly.matched} = ` +
          `${freshOnly.countPct}% по числу, ${freshOnly.mcapPct}% по капитализации`,
      );
      lines.push(`Измеренный ноль (календарь полон, впереди событий нет): ${withNumber.length - nonZero.length}`);
      lines.push(
        `Документ есть, сумма не разобрана: ` +
          `${inSelection.filter((item) => item.state === 'matched_unparsed').length}, ` +
          `просрочен: ${inSelection.filter((item) => item.state === 'source_stale').length} — ` +
          'и то и другое отказ, а не ноль',
      );
      const overhangCoverage = coverageOf(withOverhang, selection);
      lines.push(
        `Навес overhangPct известен: ${overhangCoverage.matched}/${overhangCoverage.total} = ` +
          `${overhangCoverage.countPct}% по числу, ${overhangCoverage.mcapPct}% по капитализации`,
      );
      const anySignal = selection.filter(
        (item) =>
          (overhangById.get(item.coingeckoId) ?? null) !== null ||
          withNumber.some((row) => row.candidate.coingeckoId === item.coingeckoId),
      );
      const anyCoverage = coverageOf(anySignal, selection);
      lines.push(
        `Хотя бы одна метрика токеномики: ${anyCoverage.matched}/${anyCoverage.total} = ` +
          `${anyCoverage.countPct}% по числу, ${anyCoverage.mcapPct}% по капитализации`,
      );
      lines.push(
        'Годовая эмиссия отдельной метрикой снята: источники её не содержат, а среднее ' +
          'по неоднородному вестингу прячет клифф. Фактический выпуск между снимками ' +
          '(realizedEmission) — в TODO, вне MVP',
      );
      const gapped = inSelection.filter((item) => item.note.includes('БЕЗ ГРАФИКА'));
      lines.push(
        `Отказ из-за пробела в расписании (>${MAX_TBD_PCT}% эмиссии без графика): ` +
          `${gapped.length} — ${gapped.map((item) => item.candidate.ticker).slice(0, 12).join(', ')}`,
      );
      const suspicious = withNumber
        .filter((item) => (item.dilution12mPct ?? 0) > 100)
        .map((item) => `${item.candidate.ticker} ${item.dilution12mPct}%`);
      lines.push(`Разводнение выше 100% — двойной учёт: ${suspicious.join(', ') || 'нет'}`);
      lines.push('');
      lines.push('### Контроль (ТЗ требует показать именно их)');
      lines.push(
        renderMatches(
          detailed.filter((item) =>
            controls.some((control) => control.coingeckoId === item.candidate.coingeckoId),
          ),
        ),
      );
      lines.push('');
      lines.push('### Сорок крупнейших совпавших из выборки');
      lines.push(renderMatches(inSelection.slice(0, 40)));
      lines.push('');

      const uncovered = llamaMatches
        .filter((item) => item.state !== 'exact')
        .sort((left, right) => (right.candidate.mcapCalcUsd ?? -1) - (left.candidate.mcapCalcUsd ?? -1))
        .slice(0, 20);
      lines.push('### Двадцать крупнейших непокрытых — очередь ручного слоя шага 09');
      lines.push(renderMatches(uncovered));
      lines.push('');

      const first = detailed.find((item) => item.sourceUrl !== null);
      if (first?.sourceUrl) {
        const page = await probe('defillama/page', first.sourceUrl, { accept: 'text/html' });
        probes.push(page);
        lines.push(`Открываемость sourceUrl (${page.url}): ${verdictOf(page)}`);
        lines.push('');
      }
    }
    if (process.env.DEFILLAMA_PRO_KEY) {
      const pro = await probe(
        'defillama/pro',
        `https://pro-api.llama.fi/${process.env.DEFILLAMA_PRO_KEY}/api/emissions`,
      );
      probes.push(pro);
      lines.push(`DeFiLlama Pro: ${pro.url} → ${verdictOf(pro)}, ${pro.bytes} байт`);
      lines.push('');
    }

    // ── Кандидат 2: Mobula multi-metadata.
    lines.push('## Mobula metadata / multi-metadata');
    lines.push('');
    const mobulaKey = process.env.MOBULA_API_KEY;
    const mobulaHeaders: Record<string, string> = mobulaKey ? { Authorization: mobulaKey } : {};
    if (mobulaKey === undefined) {
      lines.push(
        'MOBULA_API_KEY не задан. Прошлый прогон получил 429 с обоих хостов на первом ' +
          'запросе: источник не измерен — это не то же самое, что нулевое покрытие.',
      );
      lines.push('');
    }
    const named = sample.filter((item) => !item.name.includes(','));
    const skipped = sample.filter((item) => item.name.includes(','));
    if (skipped.length > 0) {
      lines.push(`Не запрашивались (запятая в имени ломает assets=): ${skipped.map((i) => i.ticker).join(', ')}`);
    }

    if (!options.mobula) {
      lines.push('Пропущена: измерена, прироста не дала. Запуск флагом --mobula');
      lines.push('');
    }
    let host: string | null = null;
    for (const candidateHost of options.mobula ? MOBULA_HOSTS : []) {
      const single = named[0];
      if (!single) break;
      const result = await probe(
        'mobula/metadata',
        `${candidateHost}/api/1/metadata?asset=${encodeURIComponent(single.name)}`,
        mobulaHeaders,
      );
      probes.push(result);
      lines.push(`Одиночный запрос: ${result.url} → ${verdictOf(result)}, ${result.bytes} байт, ${result.ms} мс`);
      if (result.ok && result.data !== null) {
        await store.saveRaw('mobula-metadata', single.coingeckoId, result.data);
        lines.push(`Схема ответа: \`${schemaOf(result.data)}\``);
        lines.push(`Ключ ответа (лимиты): ${result.rateLimit ?? 'заголовков лимита нет'}`);
        host = candidateHost;
        break;
      }
    }
    lines.push('');

    const mobulaMatches: Match[] = [];
    if (host !== null) {
      // multi-metadata отдаёт по одному ключу на объект и календарь выбрасывает:
      // проверено на паре Uniswap,Arbitrum — release_schedule отсутствует, тогда
      // как одиночный запрос по тем же активам возвращает 48 и 38 событий.
      lines.push(
        'Bulk не используется: multi-metadata урезает ответ до одного ключа и ' +
          'release_schedule в нём нет. Опрос идёт одиночными запросами',
      );
      lines.push('');

      const target = options.full ? selection.filter((item) => !item.name.includes(',')) : named;
      const returned: Record<string, unknown>[] = [];
      for (const candidate of target) {
        const url = `${host}/api/1/metadata?asset=${encodeURIComponent(candidate.name)}`;
        const result = await probe(`mobula/${candidate.ticker}`, url, mobulaHeaders);
        probes.push(result);
        if (!result.ok || result.data === null) continue;
        const payload = isRecord(result.data) ? result.data.data : null;
        if (!isRecord(payload)) continue;
        await store.saveRaw('mobula-metadata', candidate.coingeckoId, payload);
        // Запрос «Aave» вернул AUSDT: имя не идентификатор, символ обязан совпасть.
        const symbol = typeof payload.symbol === 'string' ? payload.symbol.toUpperCase() : null;
        if (symbol !== candidate.ticker) continue;
        returned.push(payload);
      }

      const scheduleKeys = new Set<string>();
      for (const asset of returned) {
        for (const key of Object.keys(asset)) {
          if (/release|schedule|vesting|unlock|emission/i.test(key)) scheduleKeys.add(key);
        }
      }
      lines.push(
        scheduleKeys.size > 0
          ? `Поля календаря в ответе: ${[...scheduleKeys].join(', ')}`
          : `Ни у одного из ${returned.length} активов поля календаря нет: ` +
              'release_schedule из документации на этом тарифе не отдаётся',
      );
      // Контроль на примере из самой документации: если и у него календаря нет,
      // вопрос закрыт не нашей выборкой, а обещанием источника.
      const control = await probe(
        'mobula/control-uniswap',
        `${host}/api/1/metadata?asset=Uniswap`,
        mobulaHeaders,
      );
      probes.push(control);
      const payload = isRecord(control.data) ? control.data.data : null;
      const controlKeys = isRecord(payload)
        ? Object.keys(payload).filter((key) => /release|schedule|vesting/i.test(key))
        : [];
      lines.push(
        `Контроль Uniswap: ${verdictOf(control)}, поля календаря: ${controlKeys.join(', ') || 'нет'}`,
      );
      lines.push('');

      const bySymbol = new Map<string, Record<string, unknown>[]>();
      const byContract = new Map<string, Record<string, unknown>>();
      for (const asset of returned) {
        const symbol = typeof asset.symbol === 'string' ? asset.symbol.toUpperCase() : null;
        if (symbol) bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), asset]);
        const found = new Set<string>();
        collectContracts(asset, found);
        for (const contract of found) byContract.set(contract, asset);
      }

      for (const candidate of options.full ? selection : sample) {
        mobulaMatches.push(matchMobula(candidate, contractsById, byContract, bySymbol, collisions));
      }

      const covered = mobulaMatches
        .filter((item) => item.state === 'exact')
        .map((item) => item.candidate);
      const base = options.full ? selection : sample;
      const coverage = coverageOf(covered, base);
      lines.push(
        `Покрытие (${options.full ? 'вся active selection' : 'выборка спайка'}): ` +
          `${coverage.matched}/${coverage.total} = ${coverage.countPct}% по числу, ` +
          `${coverage.mcapPct}% по капитализации`,
      );
      lines.push('');
      lines.push(renderMatches(mobulaMatches.slice(0, 40)));
      lines.push('');
    }

    // ── Кандидат 2b: Mobula v2. Ключ едет заголовком, а не в URL: в отчёт и в
    // sourceUrl он не попадёт даже случайно.
    lines.push('## Mobula v2 token/details — склейка по контракту');
    lines.push('');
    if (mobulaKey === undefined || !options.mobula) {
      lines.push(
        mobulaKey === undefined
          ? 'MOBULA_API_KEY не задан — источник не измерен.'
          : 'Пропущена: календаря в v2 нет. Запуск флагом --mobula',
      );
      lines.push('');
    } else {
      const base = options.full ? selection : sample;
      const targets = base
        .map((item) => ({ candidate: item, token: (tokensById.get(item.coingeckoId) ?? [])[0] }))
        .filter(
          (
            item,
          ): item is { candidate: UniverseCandidate; token: { chainId: string; address: string } } =>
            item.token !== undefined,
        );
      lines.push(
        `Контракт известен у ${targets.length} из ${base.length}. Нативные монеты сюда не ` +
          'попадают по построению: у XMR и KAS контракта нет и быть не может',
      );

      const v2: Match[] = [];
      let schemaShown = false;
      for (const { candidate, token } of targets.slice(0, options.full ? 400 : 30)) {
        const url = `${MOBULA_V2}?chainId=${encodeURIComponent(token.chainId)}&address=${token.address}`;
        const result = await probe(`mobula-v2/${candidate.ticker}`, url, mobulaHeaders);
        probes.push(result);
        const empty = {
          candidate, matchedBy: 'contract' as const, events: 0, future: 0,
          nextAt: null, sourceUrl: null, asOf: null,
        };
        if (!result.ok || result.data === null) {
          v2.push({ ...empty, state: 'source_missing', note: verdictOf(result) });
          continue;
        }
        await store.saveRaw('mobula-v2', candidate.coingeckoId, result.data);

        const schedule = findScheduleNode(result.data);
        if (!schemaShown) {
          lines.push(`Схема ответа: \`${schemaOf(result.data)}\``);
          lines.push(
            schedule === null
              ? 'Поля с календарём в ответе нет — v2 отдаёт метаданные, но не вестинг'
              : `Календарь найден в \`${schedule.path}\`: \`${schemaOf(schedule.value)}\``,
          );
          schemaShown = true;
        }
        if (schedule === null) {
          v2.push({ ...empty, state: 'matched_unparsed', note: 'календаря в ответе нет' });
          continue;
        }

        const events: RawEvent[] = [];
        collectEvents(schedule.value, events, 3);
        const now = Date.now();
        const ahead = events.filter((item) => {
          const at = Date.parse(item.dateIso);
          return at > now && at <= now + 365 * 86_400_000;
        });
        const tokens365 =
          events.length === 0 || ahead.some((item) => item.tokens === null)
            ? null
            : ahead.reduce((sum, item) => add(sum, item.tokens ?? 0), 0);
        const summary = summarize(events);
        const circulating = candidate.circulating;
        v2.push({
          candidate,
          state: tokens365 === null ? 'matched_unparsed' : 'exact',
          matchedBy: 'contract',
          events: summary.total,
          future: summary.future,
          nextAt: summary.nextAt,
          tokens365,
          dilution12mPct:
            tokens365 !== null && circulating !== null && circulating > 0
              ? round(pctOf(tokens365, circulating), 2)
              : null,
          // Ссылка ведёт туда, откуда пришло число, и открывается без ключа.
          sourceUrl: `https://mobula.io/asset/${encodeURIComponent(candidate.name)}`,
          asOf: result.sourceDate,
          note: `${token.chainId} ${token.address.slice(0, 10)}…`,
        });
      }

      const measured = v2.filter((item) => item.state === 'exact');
      const llamaKnown = new Set(
        llamaMatches
          .filter((item) => item.state === 'exact')
          .map((item) => item.candidate.coingeckoId),
      );
      const added = measured.filter((item) => !llamaKnown.has(item.candidate.coingeckoId));
      lines.push('');
      lines.push(
        `Измерено Mobula: ${measured.length} из ${targets.length} опрошенных. ` +
          `Из них новых, которых нет у DeFiLlama: ${added.length} — это и есть прирост покрытия`,
      );
      lines.push('');
      lines.push(renderMatches(v2.slice(0, 30)));
      lines.push('');
    }

    // ── Кандидат 3: CoinGecko. Сети нет: floatPct и fdvToMcap уже измерены вселенной.
    lines.push('## Навес overhangPct — базовая метрика, сети ноль');
    lines.push('');
    const noOverhang = selection.filter(
      (item) => (overhangById.get(item.coingeckoId) ?? null) === null,
    );
    lines.push(
      `Известен у ${withOverhang.length} из ${selection.length}: числа уже лежат в снимке. ` +
        'Токен с навесом 5% безопасен и без календаря, с навесом 100% опасен даже без него.',
    );
    lines.push(
      `Навеса нет (totalSupply неизвестен или ниже circulating): ` +
        `${noOverhang.map((item) => item.ticker).slice(0, 15).join(', ') || 'нет'}`,
    );
    lines.push('');

    const ranked = [...withOverhang].sort(
      (left, right) =>
        (overhangById.get(right.coingeckoId) ?? 0) - (overhangById.get(left.coingeckoId) ?? 0),
    );
    const edges = [...new Set([...ranked.slice(0, 12), ...ranked.slice(-5)])];
    lines.push('| Тикер | float % | Навес % | Календарь за 12м |');
    lines.push('|---|---|---|---|');
    for (const item of edges) {
      const row = llamaMatches.find((m) => m.candidate.coingeckoId === item.coingeckoId);
      const calendar =
        row?.dilution12mPct !== null && row?.dilution12mPct !== undefined
          ? `${row.dilution12mPct}%`
          : (row?.state ?? 'source_missing');
      lines.push(
        `| ${item.ticker} | ${item.floatPct ?? '—'} | ` +
          `${overhangById.get(item.coingeckoId) ?? '—'} | ${calendar} |`,
      );
    }
    lines.push('');

    lines.push('## Все запросы');
    lines.push('');
    lines.push('| Проба | Статус | Попыток | Время | Байт | Дата источника | Лимиты |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const item of probes) {
      lines.push(
        `| ${item.label} | ${verdictOf(item)} | ${item.attempts} | ${item.ms} мс | ${item.bytes} | ` +
          `${item.sourceDate ?? '—'} | ${item.rateLimit ?? '—'} |`,
      );
    }
    lines.push('');

    lines.push('## Сценарий');
    lines.push('');
    lines.push(`DeFiLlama: ${scenarioOf(llamaCoverage.mcapPct)}`);
    lines.push('');
    lines.push(
      'Решение принимает человек: спайк показывает числа и не правит ни профиль, ни веса.',
    );

    await mkdir('reports', { recursive: true });
    await writeFile(REPORT_PATH, `${lines.join('\n')}\n`, 'utf8');
    console.log(lines.join('\n'));
    console.log(`\nОтчёт: ${REPORT_PATH}`);
  } finally {
    await app.close();
  }
}

function assetsOf(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload)) {
    if (Array.isArray(payload.data)) return payload.data;
    if (isRecord(payload.data)) return Object.values(payload.data);
  }
  return [];
}

/** Склейка: сначала контракт, потом символ — и отказ, если символ неуникален. */
function matchMobula(
  candidate: UniverseCandidate,
  contractsById: Map<string, Set<string>>,
  byContract: Map<string, Record<string, unknown>>,
  bySymbol: Map<string, Record<string, unknown>[]>,
  collisions: Set<string>,
): Match {
  const empty: Omit<Match, 'state' | 'matchedBy' | 'note'> = {
    candidate, events: 0, future: 0, nextAt: null, sourceUrl: null, asOf: null,
  };

  const ours = contractsById.get(candidate.coingeckoId);
  const hit = ours ? [...ours].map((item) => byContract.get(item)).find((item) => item) : undefined;
  const symbolHits = bySymbol.get(candidate.ticker) ?? [];

  const asset = hit ?? (symbolHits.length === 1 ? symbolHits[0] : undefined);
  if (!asset) {
    if (symbolHits.length > 1 || collisions.has(candidate.ticker)) {
      return { ...empty, state: 'mapping_failed', matchedBy: 'none', note: 'тикер неуникален — отказ' };
    }
    return { ...empty, state: 'source_missing', matchedBy: 'none', note: 'источник нас не знает' };
  }

  // Календарь Mobula — готовые события: tokens_to_unlock плюс unlock_date в
  // миллисекундах. Эвристика тут не нужна и только внесла бы свои ошибки.
  const schedule = Array.isArray(asset.release_schedule) ? asset.release_schedule : [];
  const events: RawEvent[] = [];
  for (const item of schedule) {
    if (!isRecord(item)) continue;
    const dateIso = toIso(item.unlock_date);
    const tokens = amountOf(item.tokens_to_unlock);
    if (dateIso !== null) events.push({ dateIso, tokens });
  }
  const summary = summarize(events);
  // Пустой календарь не становится known_zero: молчание источника — не «эмиссии нет».
  if (summary.total === 0) {
    return {
      ...empty,
      state: 'source_missing',
      matchedBy: hit ? 'contract' : 'symbol',      note: schedule.length === 0 ? 'release_schedule отсутствует' : 'календарь пуст',
    };
  }
  const now = Date.now();
  const ahead = events.filter((item) => {
    const at = Date.parse(item.dateIso);
    return at > now && at <= now + 365 * 86_400_000;
  });
  const tokens365 = ahead.some((item) => item.tokens === null)
    ? null
    : ahead.reduce((sum, item) => add(sum, item.tokens ?? 0), 0);
  const circulating = candidate.circulating;

  return {
    candidate,
    state: tokens365 === null ? 'matched_unparsed' : 'exact',
    matchedBy: hit ? 'contract' : 'symbol',
    events: summary.total,
    future: summary.future,
    nextAt: summary.nextAt,
    tokens365,
    dilution12mPct:
      tokens365 !== null && circulating !== null && circulating > 0
        ? round(pctOf(tokens365, circulating), 2)
        : null,
    sourceUrl: `https://mobula.io/asset/${encodeURIComponent(candidate.name)}`,
    // Времени источника Mobula не сообщает: Date из заголовка — время нашего
    // запроса, и подставлять его значило бы подделать происхождение.
    asOf: null,
    note: `${schedule.length} событий в release_schedule`,
  };
}

function renderMatches(matches: readonly Match[]): string {
  const head = [
    '| Тикер | Состояние | Склейка | Событий | Впереди | Токенов 12м | Разводнение 12м, % | Ближайшее | asOf | Заметка |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  const rows = matches.map(
    (item) =>
      `| ${item.candidate.ticker} | ${item.state} | ${item.matchedBy} | ${item.events} | ` +
      `${item.future} | ${item.tokens365 ?? '—'} | ${item.dilution12mPct ?? '—'} | ` +
      `${item.nextAt ?? '—'} | ${item.asOf ?? '—'} | ${item.note} |`,
  );
  return [...head, ...rows].join('\n');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});