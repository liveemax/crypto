# ТЗ: сервис аналитических агентов на NestJS + Swagger

## КАК ВЫПОЛНЯТЬ ЭТО ЗАДАНИЕ

**Выполняй ровно один шаг за раз.** После завершения шага:

1. Убедись, что `npm run build` проходит без ошибок
2. Кратко перечисли, какие файлы создал и изменил
3. Выведи чек-лист приёмки этого шага
4. **Остановись и жди подтверждения.** Не начинай следующий шаг сам

Не забегай вперёд: не создавай заглушки будущих контроллеров, не подключай библиотеки «на будущее», не пиши код агентов раньше их шага. Каждый шаг оставляет систему в рабочем состоянии.

Если требование шага противоречит уже написанному коду — скажи об этом и предложи решение, не переписывай молча.

---

## Что строим

Сервис с набором аналитических агентов по криптоактивам. Единственный интерфейс — **Swagger UI**: пользователь заходит на `/api`, нажимает *Try it out*, вводит тикер, получает JSON. Консольного интерфейса не делаем.

Семь агентов, каждый отвечает за свой срез анализа и вызывается независимо:

| Агент | Тип | Что делает |
|---|---|---|
| `screener` | код | Базовая бизнес-эффективность, срезает большинство вселенной |
| `unlocks` | код | Net Holder Yield: возврат ценности минус разводнение |
| `value-capture` | LLM | Механизм возврата ценности: fee switch, стейкинг, выкуп |
| `revenue-quality` | LLM | Выручка с поправкой на стоимость стимулов |
| `sector-position` | код | Перцентили внутри сектора: лидер / догоняющий / переоценён |
| `organic` | LLM | Органический / субсидированный / вероятно манипулятивный рост |
| `critic` | LLM | Попытка опровергнуть тезис, а не подтвердить |

Итог — рейтинг по тирам, а не отсортированный список.

Это исследовательский инструмент: он выдаёт проверяемые данные с источниками и уровнем уверенности, а **не** рекомендации покупать или продавать. Описания в Swagger должны это отражать.

---

## Инварианты — нарушать нельзя ни на одном шаге

1. **LLM не считает числа и не вспоминает факты по памяти.** Вся арифметика — TypeScript. Модель возвращает только категории (zod `enum`) и цитирует переданный ей текст. Нет текста на входе → запись в `missing`, а не догадка.

2. **Метрика без `sourceUrl` и `asOf` обнуляется валидатором.** Это код, а не договорённость с моделью. Именно эта защита отличает аналитику от генератора уверенности.

3. **Снапшоты именуются датой и никогда не перезаписываются.** Сырые ответы API сохраняются на диск до всякой обработки.

4. **Деньги и проценты не считать в float.** `decimal.js` либо целые базисные пункты. Складываются доходности и разводнение — ошибка в третьем знаке переворачивает знак результата.

5. **Никаких выдуманных или синтетических данных в рабочих путях.** Фикстуры только в `test/`, никогда в `data/`. Синтетическое число, попавшее в рабочий снапшот, неотличимо от настоящего.

6. **При нехватке данных агент возвращает честный отказ**, а не правдоподобный результат: `score: null`, заполненный `missing`, внятный `notes`.

---

## Технологии и стиль

NestJS 10+, TypeScript в strict-режиме, `@nestjs/swagger`, `@nestjs/config`, `zod`, `decimal.js`, `@anthropic-ai/sdk`, `jest`. Node 20+.

- Комментарии, `notes`, тексты ошибок и описания в Swagger — **на русском**
- Имена файлов, классов, полей — английские; поля в camelCase
- `any` запрещён, кроме приведения `input_schema` для Anthropic SDK
- Каждый публичный метод сервиса — однострочный JSDoc
- Секреты только через `.env` + `@nestjs/config`, `.env` в `.gitignore`

---

## Целевая структура

```
src/
  main.ts
  app.module.ts
  health/health.controller.ts
  config/
    universe.ts  thresholds.ts  config.controller.ts  config.module.ts
  core/
    types.ts                      # Metric, AgentResult, SnapshotRow, AgentContext
    money.ts                      # обёртки над decimal.js
    store/store.service.ts        # кэш, снапшоты, результаты
    validate/validate.service.ts  # обнуление метрик без источника
    llm/llm.service.ts  llm.mock.ts  system-rules.ts
    fetch/defillama.service.ts  coingecko.service.ts  snapshot.service.ts
  agents/
    agent.interface.ts  base.agent.ts  agents.module.ts  agent-runner.service.ts
    screener/  unlocks/  value-capture/  revenue-quality/
    sector-position/  organic/  critic/
  api/
    agents.controller.ts  snapshot.controller.ts
    manual.controller.ts  ranking.controller.ts  dto/
  ranking/
    ranking.service.ts  report.service.ts
data/      # unlocks.json, overrides.json, docs/<TICKER>/, snapshots/, cache/, raw/
reports/
test/
```

---

## Общие контракты

Создаются на шаге 03, дальше **не меняются**. Все агенты возвращают одну форму.

```ts
// src/core/types.ts
export interface Metric {
  value: number | string | null;
  unit: string;
  sourceUrl: string | null;
  asOf: string | null;
  droppedReason?: 'no_source' | 'no_as_of';
  staleDays?: number;
}

export interface AgentResult {
  agent: string;
  title: string;
  token: string;
  sector: string | null;
  asOf: string;
  verdict: Record<string, unknown>;
  score: number | null;          // 0..100, сопоставим внутри сектора
  scoreRaw?: number;             // до поправки на качество данных
  metrics: Record<string, Metric>;
  dataQuality: number;           // 0..1
  missing: string[];
  notes: string;
  validator?: { dropped: string[]; stale: string[] };
  error?: string;
}

export interface SnapshotRow {
  ticker: string;
  name: string;
  sector: string;
  asOf: string;
  priceUsd: number | null;
  mcapUsd: number | null;
  fdvUsd: number | null;
  vol24hUsd: number | null;
  circulating: number | null;
  totalSupply: number | null;
  revenue1y: number | null;
  revenue30d: number | null;
  tvlUsd: number | null;
  mcapSource: string | null;
  feesSource: string | null;
  tvlSource: string | null;
  errors: string[];
}

export interface AgentContext {
  snapshot: SnapshotRow[];
  docsText?: string;
  docsSources?: string[];
  priorResults?: Record<string, AgentResult>;
  buyback12mUsd?: number;
  incentives12mUsd?: number;
  cashDistrib12mUsd?: number;
  burn12mUsd?: number;
}

export interface Agent {
  readonly name: string;
  readonly title: string;
  readonly needsLlm: boolean;
  readonly needs: (keyof SnapshotRow)[];
  run(token: string, row: SnapshotRow, ctx: AgentContext): Promise<AgentResult>;
}
```

---

## Карта эндпоинтов

| Метод | Путь | Тег | Шаг |
|---|---|---|---|
| GET | `/health` | system | 01 |
| GET | `/config/universe` | config | 02 |
| GET | `/config/sectors` | config | 02 |
| GET | `/config/thresholds` | config | 02 |
| POST | `/snapshot/refresh` | snapshot | 04 |
| GET | `/snapshot` | snapshot | 04 |
| GET | `/snapshot/{token}` | snapshot | 04 |
| GET | `/agents` | agents | 05 |
| POST | `/agents/{name}/{token}` | agents | 05 |
| POST | `/manual/unlocks` | manual | 07 |
| GET | `/manual/unlocks/{token}` | manual | 07 |
| DELETE | `/manual/unlocks/{id}` | manual | 07 |
| POST | `/manual/docs/{token}` | manual | 09 |
| GET | `/manual/docs/{token}` | manual | 09 |
| POST | `/manual/overrides/{token}` | manual | 10 |
| POST | `/ranking/run` | ranking | 14 |
| GET | `/ranking/latest` | ranking | 14 |
| GET | `/ranking/report/{date}` | ranking | 14 |
| POST | `/ranking/sensitivity` | ranking | 14 |

Общие query-параметры агентских эндпоинтов: `mock` (LLM-заглушка, без трат), `offline` (только кэш), `refresh` (принудительно обновить данные).

---
---

# ШАГ 01 — Скелет и Swagger

**Цель.** Приложение поднимается, Swagger открывается, один эндпоинт отвечает.

### Установить

Основное: `@nestjs/common @nestjs/core @nestjs/platform-express @nestjs/swagger @nestjs/config zod decimal.js`
Dev: `@nestjs/cli @nestjs/testing jest ts-jest @types/node @types/jest supertest`

### src/main.ts

```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const config = new DocumentBuilder()
    .setTitle('Crypto Agents')
    .setDescription(
      'Исследовательский инструмент. Выдаёт проверяемые данные с источниками и ' +
      'уровнем уверенности, а не рекомендации покупать или продавать. ' +
      'Каждое число снабжено ссылкой на источник и датой актуальности.',
    )
    .setVersion('1.0')
    .addTag('system', 'Служебное')
    .addTag('config', 'Вселенная токенов и настройки')
    .addTag('snapshot', 'Слой данных')
    .addTag('agents', 'Агенты — по одному на токен')
    .addTag('manual', 'Ручные вводы: разлоки, документация, оверрайды')
    .addTag('ranking', 'Полный прогон и рейтинг')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: { tryItOutEnabled: true, persistAuthorization: true },
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Swagger: http://localhost:${port}/api`);
}
bootstrap();
```

Теги объявляются все сразу, хотя контроллеры под них появятся позже — так порядок разделов в Swagger не будет прыгать.

### Остальное

- `HealthController`: `GET /health` → `{ status: 'ok', time: ISO, version }`
- `tsconfig`: `strict: true`, `strictNullChecks: true`, `noImplicitAny: true`
- `.env.example`: `PORT=3000`, `ANTHROPIC_API_KEY=`, `MODEL=claude-sonnet-5`
- `ConfigModule.forRoot({ isGlobal: true })` в `AppModule`
- Папки `data/` и `reports/` с `.gitkeep`, содержимое в `.gitignore`

**Приёмка.** `npm run start:dev` поднимается · `/api` открывается с заголовком и описанием · виден раздел **system** · *Try it out* → 200 · `npm run build` чистый · `.env` в `.gitignore`.

**Запрещено.** CLI и `nest-commander`. База данных, ORM, очереди. Заглушки будущих контроллеров. Отключение `strict`.

**СТОП. Жди подтверждения.**

---

# ШАГ 02 — Вселенная токенов и пороги

**Цель.** Список анализируемых активов и настройки доступны через API.

### src/config/universe.ts

```ts
export interface UniverseItem {
  ticker: string;
  name: string;
  sector: string;
  /** Слаг протокола на defillama.com — часть может быть неверна, проверяется на шаге 04 */
  defillama: string;
  /** id монеты на coingecko.com */
  coingecko: string;
}

export const UNIVERSE: UniverseItem[] = [
  { ticker: 'HYPE',   name: 'Hyperliquid', sector: 'perps',   defillama: 'hyperliquid', coingecko: 'hyperliquid' },
  { ticker: 'AAVE',   name: 'Aave',        sector: 'lending', defillama: 'aave',        coingecko: 'aave' },
  { ticker: 'MORPHO', name: 'Morpho',      sector: 'lending', defillama: 'morpho',      coingecko: 'morpho' },
  { ticker: 'SKY',    name: 'Sky',         sector: 'stables', defillama: 'sky-lending', coingecko: 'sky' },
  { ticker: 'LINK',   name: 'Chainlink',   sector: 'infra',   defillama: 'chainlink',   coingecko: 'chainlink' },
  { ticker: 'PENDLE', name: 'Pendle',      sector: 'yield',   defillama: 'pendle',      coingecko: 'pendle' },
  { ticker: 'LDO',    name: 'Lido',        sector: 'lst',     defillama: 'lido',        coingecko: 'lido-dao' },
  { ticker: 'JTO',    name: 'Jito',        sector: 'lst',     defillama: 'jito',        coingecko: 'jito-governance-token' },
  { ticker: 'SNX',    name: 'Synthetix',   sector: 'perps',   defillama: 'synthetix',   coingecko: 'havven' },
  { ticker: 'GMX',    name: 'GMX',         sector: 'perps',   defillama: 'gmx',         coingecko: 'gmx' },
  { ticker: 'AERO',   name: 'Aerodrome',   sector: 'dex',     defillama: 'aerodrome',   coingecko: 'aerodrome-finance' },
  { ticker: 'NEAR',   name: 'Near',        sector: 'l1',      defillama: 'near',        coingecko: 'near' },
  { ticker: 'STRK',   name: 'Starknet',    sector: 'l2',      defillama: 'starknet',    coingecko: 'starknet' },
];

export function findByTicker(ticker: string): UniverseItem | undefined { /* без учёта регистра */ }
export function sectors(): string[] { /* уникальные, отсортированные */ }
```

### src/config/thresholds.ts

```ts
/** Пороги хард-фильтров скринера */
export const THRESHOLDS = {
  minMcapUsd: 50_000_000,
  minAnnualRevenueUsd: 1_000_000,
  /** Выше — окупаемость за пределами разумного */
  maxPRev: 60,
} as const;

/** Веса композита. Проверяются тестом устойчивости на шаге 14. */
export const WEIGHTS = {
  valueCapture: 0.25, revenueQuality: 0.20, unlocks: 0.25,
  sectorPosition: 0.15, organic: 0.15,
} as const;

/** Метрика старше этого числа дней помечается устаревшей */
export const MAX_STALE_DAYS = 45;
```

### Эндпоинты (тег `config`)

`GET /config/universe` · `GET /config/sectors` (с подсчётом проектов) · `GET /config/thresholds`. Для каждого — DTO с `@ApiProperty` и примерами.

**Приёмка.** Universe возвращает 13 записей · в `lending` 2 проекта, в `perps` 3, в `lst` 2 · в Swagger видна схема ответа, а не пустой объект.

**Запрещено.** Читать конфиг из YAML/JSON. Эндпоинты записи в конфиг. Добавлять токены сверх списка.

**СТОП. Жди подтверждения.**

---

# ШАГ 03 — Типы, хранилище, валидатор

**Цель.** Фундамент без HTTP: контракты, файловое хранилище и главная защита системы.

### src/core/types.ts

Скопировать целиком из раздела «Общие контракты» выше. Дальше эти типы не меняются.

### src/core/money.ts

Обёртки над `decimal.js`: `add`, `sub`, `mul`, `div`, `pctOf(part, whole)`, `round(value, digits)`. Все финансовые расчёты в проекте идут только через них. Возвращают `number` для сериализации, но считают через `Decimal`.

### src/core/store/store.service.ts

Файловое хранилище в `data/`. Методы:

- `cacheGet<T>(ns, key, ttlDays = 1): Promise<T | null>` — просроченный кэш считается отсутствующим
- `cachePut<T>(ns, key, value): Promise<T>`
- `saveRaw(source, name, payload)` — сырой ответ API **до** обработки, в `data/raw/<дата>/<source>/`
- `saveSnapshot(name, rows)` — в `data/snapshots/<дата>_<name>.json`, существующий файл не перезаписывать (добавлять суффикс времени)
- `loadSnapshot<T>(name, onDate?)` — последний или на конкретную дату
- `saveResult(agent, token, result)` / `loadResult(agent, token, onDate?)` — в `data/results/<дата>/`

### src/core/validate/validate.service.ts

**Это главная защита системы.** Метод `validate(result: AgentResult, maxStaleDays = MAX_STALE_DAYS): AgentResult`:

Для каждой метрики:
- `value === null` → в `missing`, оставить как есть
- нет `sourceUrl` → обнулить `value`, `droppedReason: 'no_source'`, запись в `validator.dropped`, добавить в `missing`
- нет `asOf` → то же с `droppedReason: 'no_as_of'`
- `asOf` старше `maxStaleDays` → оставить значение, проставить `staleDays`, запись в `validator.stale`

Затем: `dataQuality = доля метрик с непустым value`; если есть устаревшие — умножить на `0.85`. Вернуть результат с очищенными метриками, отсортированным уникальным `missing` и заполненным `validator`.

Плюс хелпер-конструктор:

```ts
export function metric(
  value: number | string | null,
  sourceUrl: string | null,
  asOf: string | null,
  unit = '',
): Metric { return { value, unit, sourceUrl, asOf }; }
```

Метрики в проекте создаются **только** через него.

### Тесты (обязательно, `test/validate.service.spec.ts`)

1. Метрика со значением `45_000_000` и `sourceUrl: null` → на выходе `value === null`, есть `droppedReason: 'no_source'`, поле попало в `missing`, `dataQuality` упал
2. Метрика с `asOf` восьмимесячной давности → значение сохранено, `staleDays` проставлен, `dataQuality` умножен на 0.85
3. Все метрики валидны → `dataQuality === 1`, `validator.dropped` пуст

**Приёмка.** `npm test` — три теста зелёные. Без этого дальше не идти: если валидатор не работает, вся система превращается в генератор уверенности.

**Запрещено.** HTTP-эндпоинты на этом шаге. Прямые арифметические операции с деньгами мимо `money.ts`. Изменение контрактов из `types.ts`.

**СТОП. Жди подтверждения.**

---

# ШАГ 04 — Слой данных

**Цель.** Реальные данные приходят из внешних API и видны в Swagger.

### Сервисы

`DefillamaService`: `getFees(slug)` → `https://api.llama.fi/summary/fees/{slug}?dataType=dailyRevenue`, берёт `total24h`, `total30d`, `total1y`. `getTvl(slug)` → `https://api.llama.fi/protocol/{slug}`, из ответа удалить `chainTvls` (он огромный), взять текущий общий TVL.

`CoingeckoService`: `getMarket(id)` → `https://api.coingecko.com/api/v3/coins/{id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`. Из `market_data` взять цену, капитализацию, FDV, объём, circulating и total supply.

Оба сервиса обязаны:
- сохранять сырой ответ через `store.saveRaw` **до** обработки
- кэшировать результат на сутки
- ретраить с экспоненциальной задержкой, на HTTP 429 ждать дольше
- выдерживать паузу ~1.2 с между запросами (бесплатный тариф CoinGecko жёсткий)
- при ошибке не бросать наверх, а возвращать `null` — сбой по одному токену не должен ронять весь снапшот

> Эндпоинты могли измениться. Если ответ приходит пустым или в другой форме — не подгоняй парсинг вслепую, сообщи об этом и покажи фактическую структуру ответа.

`SnapshotService`:
- `build(tickers?: string[]): Promise<SnapshotRow[]>` — проход по вселенной, сборка строк, ошибки складывать в `row.errors`, результат в `store.saveSnapshot('universe', rows)`
- `getRow(ticker, opts): Promise<SnapshotRow>` — из последнего снапшота; если строки нет и не `offline` — точечно дотянуть; если `offline` — понятная 404
- `buildContext(ticker, opts): Promise<AgentContext>` — пока только `{ snapshot }`, остальные поля добавятся на шагах 07/09/10

### Эндпоинты (тег `snapshot`)

- `POST /snapshot/refresh` — тело `{ tickers?: string[] }`, пустое = вся вселенная. Ответ: сколько строк собрано, сколько с ошибками, список ошибок
- `GET /snapshot` — последний снапшот
- `GET /snapshot/{token}` — одна строка

**Приёмка.** `POST /snapshot/refresh` с `{"tickers":["AAVE"]}` → непустые `mcapUsd` и `revenue1y`, рядом заполнены `mcapSource` и `feesSource`. **Откройте эти ссылки в браузере и сверьте порядок величины руками.** Затем полный refresh: посмотрите, у скольких токенов `errors` непустой — это неверные слаги, зафиксируйте их список.

> Здесь уйдёт больше всего времени. Это нормально: слой данных — 60–70% работы такой системы. Если `revenue1y` пустой у половины токенов, чините слаги сейчас, а не на десятом шаге.

**Запрещено.** Подставлять значения по умолчанию вместо отсутствующих данных. Придумывать числа при ошибке API. Ходить в сеть при `offline: true`.

**СТОП. Жди подтверждения.**

---

# ШАГ 05 — Каркас агентов и контроллер

**Цель.** Механика, в которую дальше вставляются агенты по одному. Самих агентов ещё нет.

### src/agents/base.agent.ts

```ts
@Injectable()
export abstract class BaseAgent implements Agent {
  abstract readonly name: string;
  abstract readonly title: string;
  readonly needsLlm: boolean = false;
  readonly needs: (keyof SnapshotRow)[] = [];

  constructor(
    protected readonly validate: ValidateService,
    protected readonly store: StoreService,
  ) {}

  /** Вся логика агента. Возвращает частичный результат, каркас дополняет остальное. */
  protected abstract analyze(
    token: string, row: SnapshotRow, ctx: AgentContext,
  ): Promise<Partial<AgentResult>>;

  async run(token: string, row: SnapshotRow, ctx: AgentContext): Promise<AgentResult> {
    const missingInputs = this.needs.filter(f => row?.[f] == null).map(String);
    let out: AgentResult = {
      agent: this.name, title: this.title, token,
      sector: row?.sector ?? null, asOf: new Date().toISOString(),
      verdict: {}, score: null, metrics: {}, dataQuality: 0,
      missing: [...missingInputs],
      notes: missingInputs.length
        ? `Нет входных данных: ${missingInputs.join(', ')}. Результат частичный.` : '',
    };

    try {
      out = { ...out, ...(await this.analyze(token, row, ctx)) };
    } catch (e) {
      out.notes = `ОШИБКА агента: ${e}`;
      out.error = String(e);
    }

    out = this.validate.validate(out);

    // качество данных — множитель балла, а не строчка в отчёте
    if (out.score !== null && out.dataQuality < 1) {
      out.scoreRaw = out.score;
      out.score = round(out.score * (0.5 + 0.5 * out.dataQuality), 1);
    }

    await this.store.saveResult(this.name, token, out);
    return out;
  }
}
```

### Регистрация через multi-provider

```ts
export const AGENT = Symbol('AGENT');

@Module({
  imports: [CoreModule],
  providers: [AgentRunnerService],   // сюда шаг за шагом добавляются агенты
  exports: [AgentRunnerService],
})
export class AgentsModule {}
```

`AgentRunnerService` с `@Inject(AGENT) private readonly agents: Agent[]`: методы `list()` и `byName(name)` (при отсутствии — `NotFoundException` с понятным текстом на русском).

Массив агентов пока пуст — при пустом multi-provider Nest может ругаться, обеспечь корректную работу с пустым списком.

### DTO для Swagger

`MetricDto` и `AgentResultDto` с `@ApiProperty` и примерами: `value` (nullable, пример `1240000000`), `unit` (`'USD'`), `sourceUrl` (`'https://defillama.com/protocol/aave'`), `asOf`, `droppedReason` (enum), `score` (nullable, 0..100), `dataQuality` (0..1, описание «доля метрик с непустым значением и источником»), `missing`, `notes`, `verdict`.

### src/api/agents.controller.ts

```ts
@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  @Get()
  @ApiOperation({ summary: 'Список подключённых агентов' })
  list() { /* runner.list() */ }

  @Post(':name/:token')
  @ApiOperation({ summary: 'Запустить агента по токену' })
  @ApiParam({ name: 'name', enum: ['screener','unlocks','value-capture',
    'revenue-quality','sector-position','organic','critic'] })
  @ApiParam({ name: 'token', example: 'AAVE' })
  @ApiQuery({ name: 'mock', required: false, type: Boolean,
    description: 'LLM-заглушка: без API-ключа и без трат' })
  @ApiQuery({ name: 'offline', required: false, type: Boolean,
    description: 'Только кэш, в сеть не ходить' })
  @ApiQuery({ name: 'refresh', required: false, type: Boolean })
  @ApiOkResponse({ type: AgentResultDto })
  async run(/* ... */) { /* getRow → buildContext → runner.byName(name).run(...) */ }
}
```

`enum` в `@ApiParam` даёт в Swagger **выпадающий список агентов** — это ключевой элемент интерфейса. Имена агентов в URL пишутся через дефис (`value-capture`), в коде — camelCase.

**Приёмка.** `GET /agents` возвращает пустой массив без ошибки · `POST /agents/{name}/{token}` виден в Swagger с выпадающим списком · вызов несуществующего агента → 404 с русским текстом · в схеме ответа видна структура `AgentResultDto`.

**Запрещено.** Писать логику агентов. Хардкодить список агентов в контроллере мимо DI — он берётся из `runner.list()`.

**СТОП. Жди подтверждения.**

---

# ШАГ 06 — Агент screener

**Цель.** Первый рабочий агент. LLM не нужен.

Четыре базовые проверки: есть ли выручка → достаточна ли она относительно капитализации → в разумных ли пределах P/Rev → проходит ли капитализация минимальный порог.

### Логика

Выручка за 12 месяцев: `revenue1y`, при его отсутствии — `revenue30d × 12.17` (run-rate). Основание расчёта записать в `verdict.revenueBasis` — это важно, run-rate и факт не одно и то же.

Считать `pRev = mcapUsd / revenue12m` и `fdvRev = fdvUsd / revenue12m`.

Проверки против `THRESHOLDS`: `hasRevenue`, `revenueAboveMin`, `mcapAboveMin`, `pRevSane`. Все пройдены → `verdict.passed = true`. Иначе `failedChecks` со списком причин на русском.

Балл: `100 − 100 × (pRev / maxPRev)`, зажать в 0..100. Нет выручки → 0.

Метрики (все через `metric()`, с источниками из строки снапшота): `mcapUsd`, `fdvUsd`, `revenue12mUsd`, `pRev`, `fdvRev`, `tvlUsd`, `vol24hUsd`.

`needs = ['mcapUsd']`.

Зарегистрировать в `AgentsModule` как multi-provider.

### Приёмка

1. `POST /agents/screener/AAVE` → `score` — число, `metrics.pRev.value` заполнен, у каждой метрики непустой `sourceUrl`
2. `POST /agents/screener/MORPHO` → если P/Rev высокий, `verdict.passed = false` и в `failedChecks` внятная причина
3. `GET /agents` → агент появился в списке

**4. Негативный тест — обязательный.** Временно (в тесте, не в рабочих данных) подать строку снапшота с `feesSource: null`. Ожидается: метрики выручки и P/Rev обнулены с `droppedReason: 'no_source'`, `dataQuality` упал, `score` уменьшился относительно полного варианта, поля попали в `missing`.

**Если негативный тест не проходит — валидатор не подключён к каркасу. Не идти дальше, чинить.**

**Запрещено.** Подставлять дефолты вместо отсутствующей выручки. Считать P/Rev в обычном float мимо `money.ts`. Вызывать LLM.

**СТОП. Жди подтверждения.**

---

# ШАГ 07 — Агент unlocks и ввод разлоков

**Цель.** Net Holder Yield — самый ценный показатель системы. Именно он ломает большинство красивых историй: выкуп 10% при разводнении 20% даёт структурный минус, а не доходность 10%.

```
NHY = cashYield + buybackYield + burnYield − dilution12m
```

### Хранение разлоков

Файл `data/unlocks.json`, массив записей: `{ id, ticker, date, tokens, category, sourceUrl, createdAt }`.

Эндпоинты (тег `manual`):
- `POST /manual/unlocks` — тело `{ ticker, date, tokens, category, sourceUrl }`. **`sourceUrl` обязателен и валидируется как URL** — запись без источника принимать нельзя. `category` — enum: `team`, `investors`, `community`, `ecosystem`, `other`
- `GET /manual/unlocks/{token}` — что уже введено
- `DELETE /manual/unlocks/{id}`

### Логика агента

Из контекста берутся (могут отсутствовать): `buyback12mUsd`, `cashDistrib12mUsd`, `burn12mUsd`. Каждый превращается в доходность как процент от капитализации.

Разводнение: суммировать разлоки на горизонтах 30 / 90 / 365 дней вперёд от сегодня, посчитать долю от `circulating` и стоимость в USD по текущей цене. `dilution12m` — процент на 365 дней.

**Стоимость ближайшего разлока в дневных объёмах**: `usdРазлока / vol24hUsd`. Разлок на 3 дневных объёма и на 30 — принципиально разные события, это поле обязательно.

Балл: NHY ≥ 5% → 90+; 0..5% → `50 + nhy × 8`; отрицательный → `50 + nhy × 2.5`, не ниже 0.

`verdict.dilutionRisk`: `низкий` (<5%), `средний` (5–15%), `высокий` (>15%), `неизвестен`.

`verdict.hardFilterFail = true`, если NHY отрицательный.

### Честность при неполных данных — обязательна

- Разводнение неизвестно → в `notes`: «разводнение неизвестно, NHY завышен»
- Возврат ценности неизвестен → «возврат ценности неизвестен, NHY занижен»
- Календарь пуст → `missing: ['нет данных о разлоках для <TOKEN>']`

Молча выдать число нельзя ни в одном из этих случаев.

### Арифметика

Все расчёты через `money.ts` / `decimal.js`. Здесь складываются проценты и вычитается разводнение — накопленная ошибка float может перевернуть знак NHY на пограничном активе.

**Приёмка.** `POST /manual/unlocks` без `sourceUrl` → 400 · с корректным телом → 201 · `POST /agents/unlocks/HYPE` → в `verdict` появились `dilution12mPct`, `nextUnlock.costInDailyVolumes`, `netHolderYieldPct` · при пустом календаре агент возвращает результат с честной пометкой о неполноте, а не выдуманное число · при отрицательном NHY → `hardFilterFail: true`.

**Запрещено.** Принимать разлоки без источника. Считать NHY в float. Выдавать число без пометки о том, какие компоненты неизвестны.

**СТОП. Жди подтверждения.**

---

# ШАГ 08 — LLM-сервис со строгой схемой

**Цель.** Единственный способ получить ответ модели — со строгой zod-схемой и рантайм-валидацией. Агентов на этом шаге не пишем.

### src/core/llm/system-rules.ts

```ts
export const SYSTEM_RULES = `Ты — узкоспециализированный агент криптоаналитической системы.

ЖЁСТКИЕ ПРАВИЛА:
1. Ты НЕ вычисляешь числа. Арифметику делает код. Если в схеме есть числовое
   поле — заполняй его ТОЛЬКО значением, дословно присутствующим во входных
   данных. Иначе null.
2. Ты НЕ вспоминаешь факты по памяти. Любое утверждение опирается на текст,
   который тебе передали. Нет во входных данных — значит null и запись в missing.
3. Каждое содержательное утверждение сопровождается ссылкой из входных данных.
   Нет ссылки — утверждение не делается.
4. Ты отвечаешь категориями и классификациями, а не мнением о цене. Никаких
   прогнозов, рекомендаций покупать или продавать и целевых уровней.
5. Неуверенность выражается через confidence и missing, а не через осторожные
   формулировки в тексте.`;
```

### src/core/llm/llm.service.ts

```ts
async structured<T>(
  prompt: string,
  schema: z.ZodType<T>,
  toolName: string,
  opts?: { maxTokens?: number; cacheKey?: string; retries?: number },
): Promise<T>
```

Реализация: `messages.create` с `tools: [{ name: toolName, input_schema: zodToJsonSchema(schema) }]` и `tool_choice: { type: 'tool', name: toolName }`, система — `SYSTEM_RULES`. Из ответа взять блок `tool_use`, прогнать через **`schema.parse()`** и вернуть.

`schema.parse()` обязателен: он гарантирует, что дальше по пайплайну идут только валидные данные. Модель вернула не то — падаем сразу и понятно, а не через три шага странным образом.

Ретраи с экспоненциальной задержкой. Кэширование по `cacheKey` через `StoreService` (кэш возвращать тоже через `parse`).

Модель из `process.env.MODEL`, ключ из `ANTHROPIC_API_KEY`. Клиент создавать лениво: без ключа сервис должен собираться, а падать только при реальном вызове, с понятным сообщением «нет ANTHROPIC_API_KEY, используйте mock=true».

### src/core/llm/llm.mock.ts

`LlmMockService` с тем же интерфейсом: генерирует объект по zod-схеме (первое значение для enum, `null` для чисел, `'[mock]'` для строк, `[]` для массивов, `false` для boolean). Результат должен проходить `schema.parse()`.

Подключается по флагу `mock: true` в query. Благодаря ему любой LLM-агент отлаживается без ключа и без трат.

### Проверка

Временный `POST /debug/llm-ping` со схемой `{ ok: boolean, echo: string }`. **После проверки эндпоинт удалить.**

> Формат tool use и имена моделей могли измениться. Свериться с https://docs.claude.com/en/docs/build-with-claude/tool-use перед реализацией. Если формат отличается — сообщить, а не подгонять вслепую.

**Приёмка.** С реальным ключом `/debug/llm-ping` возвращает валидный объект · с `mock: true` возвращает валидную пустую структуру · без ключа и без mock — понятная ошибка, а не стектрейс · подмена схемы на несовместимую → выброс из `parse()`, а не тихий проброс.

**Запрещено.** Просить у модели свободный текст и парсить его. Пропускать `schema.parse()`. Логировать ключ. Вызывать модель без `SYSTEM_RULES`.

**СТОП. Жди подтверждения.**

---

# ШАГ 09 — Агент value-capture

**Цель.** Первый LLM-агент. Отвечает на вопрос, ради которого система существует: проект может быть успешным, а токен бесполезным.

### Загрузка документации

`POST /manual/docs/{token}` — тело `{ url, text }`, оба обязательны, `url` валидируется. Сохранять в `data/docs/<TICKER>/`, первой строкой файла `URL: <url>`.
`GET /manual/docs/{token}` — список загруженных источников.

`SnapshotService.buildContext` дополнить: подхватывать документацию в `ctx.docsText` и `ctx.docsSources`.

### Схема (zod)

```ts
export const ValueCaptureSchema = z.object({
  feeSwitchStatus: z.enum(['active_paid','approved_not_live','discussed','none','unknown'])
    .describe('active_paid — деньги фактически идут держателям, а не просто проголосованы'),
  stakingSource: z.enum(['fees','emissions','mixed','no_staking','unknown'])
    .describe('стейкинг из комиссий создаёт ценность, из новой эмиссии — нет'),
  buybackSource: z.enum(['revenue','treasury','none','unknown'])
    .describe('выкуп из выручки устойчив, из казны конечен'),
  tokenRequiredForProduct: z.enum(['required','optional_discount','governance_only','unknown']),
  valueFlowsToHolder: z.boolean(),
  conditionsOrGates: z.array(z.string())
    .describe('условия, при которых механизм не работает, например порог цены базового актива'),
  evidence: z.array(z.object({ claim: z.string(), url: z.string().url() })),
  missing: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
```

Все поля — категории. Ни одного числового поля, которое модель могла бы «посчитать».

### Балл считается кодом

Модель балл не ставит. Таблицы очков:
- feeSwitch: `active_paid` 40, `approved_not_live` 15, `discussed` 5, остальное 0
- staking: `fees` 25, `mixed` 12, `no_staking` 5, `emissions` 0, `unknown` 0
- buyback: `revenue` 25, `treasury` 8, остальное 0
- tokenRequired: `required` 10, `optional_discount` 5, остальное 0

Сумма умножается на `(0.5 + 0.5 × confidence)`.

### Хард-фильтр

`verdict.hardFilterFail = true`, если одновременно: feeSwitch в (`none`, `unknown`) И buyback в (`none`, `unknown`) И staking в (`emissions`, `no_staking`, `unknown`) И tokenRequired в (`governance_only`, `unknown`). Формулировка в `notes`: «Связь "успех протокола → токен" не обнаружена».

### Поведение без документации

`score: null`, `missing: ['нет документации в data/docs/<TOKEN>/']`, в `notes` — инструкция, как загрузить. **Ни при каких условиях не отвечать по памяти модели.**

### Промпт

Передать текст документации (обрезать до разумного размера) и явно перечислить различия, которые нужно поймать: проголосован ≠ выплачивается; стейкинг из комиссий ≠ из эмиссии; выкуп из выручки ≠ из казны; условия выключения механизма. Завершить требованием отвечать только по переданному тексту.

**Приёмка.** `POST /agents/value-capture/LDO` **без** документации → внятный отказ, `score: null` · загрузить доку через `POST /manual/docs/LDO` → повторный вызов даёт категории и непустой `evidence` · **открыть одну ссылку из `evidence` и проверить, что утверждение действительно там есть** · с `mock: true` работает без ключа.

**Запрещено.** Отвечать по памяти при отсутствии документации. Позволять модели ставить балл. Добавлять в схему числовые поля, кроме `confidence`. Принимать `evidence` без валидного URL.

**СТОП. Жди подтверждения.**

---

# ШАГ 10 — Агент revenue-quality

**Цель.** Не вся выручка одинаково полезна. Ключевая величина — выручка за вычетом стоимости раздаваемых токенов.

```
incentiveAdjustedRevenue = revenue12m − incentives12mUsd
```

Если проект платит стимулов на 10 млн и собирает 8 млн комиссий, экономика отрицательная — как бы красиво ни рос график сборов.

### Оверрайды

`POST /manual/overrides/{token}` — тело с необязательными полями `buyback12mUsd`, `incentives12mUsd`, `cashDistrib12mUsd`, `burn12mUsd` и **обязательным `sourceUrl`**. Хранить в `data/overrides.json`.

`buildContext` дополнить: подхватывать оверрайды в соответствующие поля `AgentContext`. Это же включит компоненты NHY у агента `unlocks` — проверить, что после ввода `buyback12mUsd` его результат изменился.

### Схема (zod)

```ts
export const RevenueQualitySchema = z.object({
  recurringShare: z.enum(['mostly_recurring','mixed','mostly_one_off','unknown']),
  concentration: z.enum(['diversified','one_main_product','single_client_or_pool','unknown']),
  dependsOnIncentives: z.enum(['no','partially','heavily','unknown']),
  revenueAfterLpPayoutsKnown: z.boolean(),
  evidence: z.array(z.object({ claim: z.string(), url: z.string().url() })),
  missing: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
```

Очки: recurring — 40/20/5/0; concentration — 30/15/3/0; dependsOnIncentives — 30/12/0/0. Умножить на `(0.5 + 0.5 × confidence)`.

### Итоговый балл

Если стимулы известны — числовая маржа важнее классификации: `0.6 × маржа + 0.4 × балл модели`. Если неизвестны — только балл модели, и в `missing` запись «стоимость token incentives за 12м неизвестна».

Дополнительная метрика: `revenuePerTvlPct`.

Если `incentiveAdjustedRevenue < 0` → в `notes`: «Экономика отрицательная после стимулов».

**Приёмка.** Ввести через оверрайды стимулы заведомо больше выручки → балл упал, в `notes` появилась пометка об отрицательной экономике · без документации агент работает по числовой части и честно пишет, что состав выручки не классифицирован · после ввода `buyback12mUsd` результат `unlocks` для того же токена изменился.

**Запрещено.** Принимать оверрайды без `sourceUrl`. Считать маржу в float. Заполнять неизвестные стимулы нулём — это превращает «неизвестно» в «нет стимулов».

**СТОП. Жди подтверждения.**

---

# ШАГ 11 — Агент sector-position

**Цель.** Сравнение только с прямыми конкурентами. Перпдекс и L1 нельзя мерить одной линейкой — у них разная нормальная маржинальность. LLM не нужен.

### Логика

Из `ctx.snapshot` отобрать проекты того же сектора. Если конкурентов меньше двух — честный отказ: `score: null`, `missing: ['в секторе <X> менее 2 проектов']`, в `notes` — предложение добавить конкурентов в `universe.ts`.

Считать:
- `revenueSharePct` — доля в суммарной выручке сектора
- `tvlSharePct` — доля в суммарном TVL
- `revenuePerTvlPct` — эффективность
- `pRev` — оценка

Нормализовать в **перцентили внутри сектора**: эффективность (больше — лучше), дешевизна по P/Rev (меньше — лучше), доля выручки (больше — лучше). Балл — среднее доступных перцентилей.

### Классификация (`verdict.role`)

- **лидер сектора** — доля выручки ≥ 40% и перцентиль эффективности ≥ 60
- **переоценён относительно конкурентов** — перцентиль дешевизны < 30 и перцентиль доли < 50
- **догоняющий** — перцентиль эффективности ≥ 50
- **аутсайдер** — остальное

В `verdict.peers` перечислить, с кем именно шло сравнение — иначе результат непроверяем.

**Приёмка.** `POST /agents/sector-position/AAVE` и `/MORPHO` → роли разные, в `peers` указан конкурент · `POST /agents/sector-position/LINK` (единственный в секторе `infra`) → честный отказ, а не выдуманный балл.

**Запрещено.** Сравнивать проекты из разных секторов. Выдавать балл при одном участнике сектора. Вызывать LLM.

**СТОП. Жди подтверждения.**

---

# ШАГ 12 — Агент organic

**Цель.** Отделить реальное использование от субсидированного и манипулятивного роста.

Важное ограничение, которое должно быть отражено в `notes` агента: это **дешёвые прокси, а не полноценный он-чейн-форензик**. Кластеризация кошельков и sybil-детект — отдельная задача на месяцы. Здесь ловится очевидное, не всё.

### Численная часть (код)

`turnover24hPct = vol24hUsd / mcapUsd × 100`. Флаги:
- больше 50% → «оборот X% от капитализации за сутки, проверьте wash trading»
- меньше 0.5% → «токен неликвиден, выход из позиции будет дорогим»

### Схема (zod)

```ts
export const OrganicSchema = z.object({
  classification: z.enum(['organic','subsidized','likely_manipulated','unknown']),
  signalsFound: z.array(z.string()),
  retentionAfterIncentives: z.enum(['held_up','declined_moderately','collapsed','no_data'])
    .describe('что стало с активностью после окончания программы стимулов'),
  airdropCorrelation: z.enum(['none','weak','strong','no_data']),
  evidence: z.array(z.object({ claim: z.string(), url: z.string().url() })),
  missing: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
```

Очки: organic 90, subsidized 45, likely_manipulated 10, unknown 40. Корректировки: `held_up` +10, `collapsed` −25, `airdropCorrelation: strong` −20, каждый численный флаг −10. Умножить на `(0.6 + 0.4 × confidence)`.

Без текста в контексте агент работает только по численным прокси и пишет об этом в `missing`.

**Приёмка.** Токен с высоким оборотом получает флаг · без текста агент возвращает численную часть и честную пометку · в `notes` присутствует оговорка про ограниченность метода.

**Запрещено.** Заявлять уверенную органичность на одних численных прокси. Опускать оговорку про ограниченность.

**СТОП. Жди подтверждения.**

---

# ШАГ 13 — Агент critic

**Цель.** Попытаться опровергнуть тезис, а не подтвердить. Запускается по верхушке рейтинга — деньги идут туда, там и нужна проверка.

### Сбор контекста

Перед вызовом собрать результаты остальных агентов в `ctx.priorResults`: сначала из кэша (`store.loadResult` за сегодня), недостающих прогнать. Передавать модели не полные результаты, а выжимку: `verdict`, `score`, `dataQuality`, `missing` по каждому агенту.

### Схема (zod)

```ts
export const CriticSchema = z.object({
  thesisRestated: z.string().describe('тезис в одну фразу'),
  killerFact: z.string()
    .describe('ОДИН конкретный проверяемый факт, который полностью разрушил бы тезис'),
  whereToCheck: z.string().describe('где именно этот факт проверить'),
  isFalsifiable: z.boolean(),
  successWithoutToken: z.boolean()
    .describe('может ли проект преуспеть, а токен остаться бесполезным'),
  ifIncentivesStop: z.string(),
  singleSourceRisk: z.boolean(),
  dataGaps: z.array(z.string()),
  liquidityConcern: z.enum(['none','moderate','severe','unknown']),
  confidenceInThesis: z.number().min(0).max(1),
});
```

### Балл

База: `confidenceInThesis × 100`. Штрафы: `isFalsifiable: false` −30, `successWithoutToken: true` −25, `singleSourceRisk: true` −10, `liquidityConcern: severe` −20 (`moderate` −8).

Штраф за нефальсифицируемость — не придирка: тезис, который нельзя опровергнуть, нельзя и подтвердить.

### Промпт

Явно поставить задачу опровергнуть, а не подтвердить. Потребовать конкретики: не «есть риски регулирования», а проверяемое утверждение вида «если доля выручки от одного пула упадёт ниже X, механизм выкупа остановится». Если конкретный факт назвать нельзя — `isFalsifiable: false`.

**Приёмка.** `POST /agents/critic/AAVE` → `killerFact` содержит конкретное проверяемое утверждение, `whereToCheck` указывает на источник · если приходят общие слова — промпт плохой, доработать · без результатов других агентов → честный отказ с инструкцией.

**Запрещено.** Принимать общие рассуждения о рисках как `killerFact`. Запускать критика без `priorResults`.

**СТОП. Жди подтверждения.**

---

# ШАГ 14 — Рейтинг и проверка системы

**Цель.** Одна кнопка → полный прогон → тиры и лучшие по секторам. Плюс механизм проверки самой системы.

### RankingService

**1. Хард-фильтры.** Не попадает в основной рейтинг независимо от популярности проекта:
- `value-capture.verdict.hardFilterFail` — нет связи «успех протокола → токен»
- `unlocks.verdict.hardFilterFail` — отрицательный NHY
- `screener.verdict.passed === false`

Такие уходят в `watchlist` **с указанием причины** и с пометкой, какое событие вернуло бы их в рейтинг.

**2. Композит** по весам из `WEIGHTS`, с нормировкой на сумму весов доступных агентов.

**3. Тиры вместо позиций:**
- есть хард-фильтр → `watchlist`
- нет балла или `dataQuality < 0.5` → `C`
- балл ≥ 70 и `dataQuality ≥ 0.7` → `A`
- балл ≥ 45 → `B`
- иначе → `C`

Разница между 4-м и 9-м местом в таком рейтинге — шум, поэтому внутри тира порядок условный.

**4. Лучшие в каждом секторе** — по 1–2 проекта. Общий отсортированный список тоже вывести, но главным считать секторный срез: сравнивать лидера лендингов с лидером инфраструктуры одним числом бессмысленно.

### Карточка проекта

Формировать по каждому активу: проект, сектор, капитализация, выручка 12м, P/Rev, состояние fee switch / стейкинга / выкупа, NHY, риск разводнения, ближайший разлок в дневных объёмах, качество выручки, позиция в секторе, органичность, что разрушает тезис, где проверить, качество данных, тир, композит.

### Fan-out

Параллельно через `p-limit`, 3–4 одновременно — иначе rate limit. Критика запускать только для прошедших хард-фильтры с композитом ≥ 45.

### Эндпоинты (тег `ranking`)

- `POST /ranking/run` — тело `{ sector?, mock?, noCritic? }`. Ответ: тиры, watchlist с причинами, лучшие по секторам, карточки
- `GET /ranking/latest`
- `GET /ranking/report/{date}` — markdown-отчёт из `reports/`

### Тест устойчивости к весам

`POST /ranking/sensitivity` — 25 прогонов композита со случайно изменёнными на ±30% весами, считается средняя перестановка топ-10.

Интерпретация в ответе: перестановка ≤ 1 позиции → «рейтинг устойчив»; больше → «рейтинг определяется вашими весами, а не данными, модель нужно упрощать».

### Журнал

`reports/journal.md` дополняется при каждом прогоне: дата, тир A и B, композиты. Плюс постоянная секция с инструкцией: через 3 и 6 месяцев сравнить равновзвешенную корзину из своего топа с равновзвешенной корзиной BTC/ETH; систематический проигрыш означает, что систему надо чинить или выбросить.

Это единственная честная проверка всей конструкции. Без неё система остаётся упражнением в оформлении.

### Дисклеймер

В ответ `POST /ranking/run` и в конец markdown-отчёта добавить: «Исследовательский инструмент. Не является инвестиционной рекомендацией. Каждое число проверяется по указанному источнику.»

**Приёмка.** `POST /ranking/run` с `{"sector":"lending","mock":true}` → тиры распределены, watchlist с причинами · полный прогон формирует markdown в `reports/` · `POST /ranking/sensitivity` возвращает число и интерпретацию · в карточке видно, почему проект оказался там, где оказался · журнал дополняется.

**Запрещено.** Усреднять баллы вслепую, игнорируя хард-фильтры. Выдавать единый отсортированный список как главный результат. Опускать дисклеймер.

**СТОП. Проект готов.**

---
---

## Подводные камни

**zod и Swagger — разные схемы.** zod валидирует ответы модели, `@ApiProperty` описывает HTTP-контракт. Либо держать раздельно, либо взять `nestjs-zod` (`createZodDto`, `patchNestJsSwagger`). Решить на шаге 05, переделывать позже дорого.

**Плавающая точка в деньгах.** `0.1 + 0.2 !== 0.3`. В NHY складываются доходности и вычитается разводнение — накопленная ошибка переворачивает знак на пограничном активе. Только `decimal.js`.

**Rate limit CoinGecko.** Бесплатный тариф жёсткий. Без пауз и кэша снапшот придёт наполовину пустым, и легко решить, что дело в слагах.

**Слаги DeFiLlama в `universe.ts` — предположения.** Часть наверняка неверна. Обнаружится на шаге 04 пустой выручкой. Не подгонять парсинг, а исправлять слаг.

**Кэш обязателен с самого начала.** Без него каждая отладка LLM-агента стоит денег и времени.

**Порядок шагов не менять.** Шаги 01–07 не требуют API-ключа вообще. Это половина ценности системы, отлаживаемая бесплатно. Начать с LLM-агентов — значит отлаживать промпты поверх непроверенных данных, где непонятно, кто виноват.