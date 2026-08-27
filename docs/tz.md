# ТЗ: массовая оценка, LLM-агенты и рейтинг — шаги 08–15

Заменяет прежний `docs/tz.md`. Шаги 01–07 выполнены; существующая логика
динамической вселенной, `screen` и `alpha` не переделывается.

Инварианты, ловушки прода, границы слоёв, формат правок и формат ответа — в
`CLAUDE.md`. Здесь описаны только оставшиеся контракты реализации и приёмки.

## Как выполнять

Один шаг за раз. После каждого шага: `npm run build` чистый, `npm test` зелёный,
перечень созданных и изменённых файлов, чек-лист приёмки, **стоп и ожидание
подтверждения**. Не добавлять заглушки следующего шага.

Шаги 08–09 не требуют LLM-ключа. Модель появляется только на шаге 10. Сначала
должна полностью работать массовая кодовая оценка, затем поверх её сохранённого
результата запускаются настоящие LLM-агенты.

---

## Что уже построено и не меняется

Вселенная — один неизменяемый снимок фактов. Рабочий состав получается
композицией двух независимых обратимых фильтров:

```text
snapshot → screen → alpha
```

- `screen` — абсолютный отсев шлаковых токенов по правилам профиля;
- `alpha` — top-N внутри перенасыщенных групп сравнения;
- можно включить оба фильтра, только один или ни одного;
- при выключенных фильтрах рабочий состав равен всей вселенной;
- порядок HTTP-вызовов не меняет порядок вычисления;
- `POST` изменяет состояние конкретного фильтра, `GET` только читает композицию;
- `enabled: false` выключает только названный фильтр и не стирает его конфигурацию.

Действующие endpoints шагов 01–07 сохраняют пути и смысл:

- `POST /universe/refresh`;
- `POST /universe/prices`;
- `POST /universe/screen`;
- `POST /universe/alpha`;
- `POST /universe/compare`;
- `GET /universe/status`;
- `GET /universe/coverage`;
- `GET /universe/funnel`;
- `GET /universe`;
- `GET /config/profiles`;
- `GET /agents` и `POST /agents/{name}/{token}` — каркас шага 07, который на
  оставшихся шагах используется только настоящими LLM-агентами.

Состав `active selection` всегда берётся через текущий `UniverseView`:

```ts
view.candidates.filter((candidate) => candidate.passed)
```

Ни оценка, ни LLM-агенты не имеют права самостоятельно включать `screen` или
`alpha`, менять `ActiveFilterState` либо повторно отсеивать universe скрытым
фильтром.

---

## Главное изменение: одна массовая оценка вместо трёх кодовых агентов

Старые `screener`, `unlocks` и `sector-position` не являются агентами. Это три
компонента одной кодовой оценки, запускаемой по всей текущей выборке:

| Компонент | Что сохраняется из прежнего замысла | Откуда берутся данные |
|---|---|---|
| `valuation` | дешевизна, базовые проверки, P/Rev, take rate | готовый кандидат вселенной |
| `tokenomics` | разлоки, разводнение, NHY, давление на объём | кандидат + автоматический источник tokenomics |
| `sectorPosition` | место, перцентили, peers, роль в нише | общий код сравнения, используемый alpha |

Все три компонента запускаются одним `POST /evaluation/run`. Per-token POST для
кодовых компонентов не создаётся. Один токен читается через
`GET /evaluation/{token}` из уже выполненного массового прогона.

После оценки остаются два настоящих агента:

- `mechanism` — классифицирует механизм возврата ценности по переданным
  документам и фактам оценки;
- `critic` — пытается опровергнуть уже собранный тезис.

Модель не вычисляет числа, не вспоминает проект по памяти и не меняет состав
вселенной.

Итоговый конвейер:

```text
snapshot → [screen?] → [alpha?] → evaluation → mechanism → critic → ranking
```

Квадратные скобки означают необязательный фильтр. `evaluation` обязана работать
при любой из четырёх комбинаций `screen`/`alpha`, включая оба выключенных.

---

## Термины и контракты

### Кодовая оценка

```ts
export type EvaluationComponentName =
  | 'valuation'
  | 'tokenomics'
  | 'sectorPosition';

export interface EvaluationBlock {
  component: EvaluationComponentName;
  title: string;
  verdict: Record<string, unknown>;
  score: number | null;
  scoreRaw?: number;
  metrics: Record<string, Metric>;
  dataQuality: number;
  missing: string[];
  notes: string;
  validator?: { dropped: string[]; stale: string[] };
  error?: string;
}

export interface CandidateEvaluation {
  coingeckoId: string;
  ticker: string;
  name: string;
  sector: string | null;
  comparisonGroup: string | null;
  tier: Tier;
  evaluationProfileId: string;
  valuation: EvaluationBlock;
  tokenomics: EvaluationBlock;
  sectorPosition: EvaluationBlock;
}

export interface EvaluationRun {
  runId: string;
  createdAt: string;
  universeVersion: string;
  builtAt: string;
  activeFilters: ActiveFilterState;
  evaluationProfile: AnalysisProfile;
  inputCount: number;
  evaluatedCount: number;
  dataGapCount: number;
  summaries: Record<EvaluationComponentName, EvaluationSummary>;
  candidates: CandidateEvaluation[];
}
```

`evaluationProfile` задаёт шкалы баллов и хард-проверки оценки, но не меняет
`activeFilters`. Если в запросе профиль не передан, используется `default`.

### Профиль

Поле `AnalysisProfile.agents` больше не содержит кодовые компоненты. Контракт
разделяется явно:

```ts
codeEvaluations: ['valuation', 'tokenomics', 'sectorPosition'];
llmAgents: ['mechanism', 'critic'];
weights: {
  tokenomics: 0.35;
  mechanism: 0.25;
  valuation: 0.20;
  sectorPosition: 0.20;
};
```

`critic` в веса не входит: он применяется штрафным множителем. Таблицы очков
LLM-категорий остаются заморожены в коде.

### Происхождение

Каждый `EvaluationRun` содержит полную копию `activeFilters`, а не только
`profileId`. Если после прогона состояние фильтров изменилось, сохранённая оценка
не удаляется, но считается результатом прежней выборки. Ranking обязан проверять
совпадение `universeVersion` и `activeFilters` либо требовать новый evaluation.

---

## Карта новых endpoints

Существующие endpoints не переименовываются и не меняют смысл.

| Метод | Путь | Назначение | Шаг |
|---|---|---|---|
| POST | `/evaluation/run` | массовая кодовая оценка active selection | 09 |
| GET | `/evaluation/status` | ход текущего прогона оценки | 09 |
| GET | `/evaluation/latest` | последний прогон, список страницами | 09 |
| GET | `/evaluation/{token}` | три компонента одного токена | 09 |
| POST | `/manual/docs/{token}` | необязательный override документации | 11 |
| GET | `/manual/docs/{token}` | прочитать сохранённые документы | 11 |
| POST | `/agents/mechanism/{token}` | точечная проверка настоящего агента | 11 |
| POST | `/agents/critic/{token}` | точечная проверка настоящего агента | 12 |
| POST | `/ranking/run` | полный массовый прогон поверх evaluation | 14 |
| GET | `/ranking/latest` | последний рейтинг | 14 |
| GET | `/ranking/report/{date}` | markdown-отчёт | 15 |
| POST | `/ranking/sensitivity` | чувствительность к весам без сети | 15 |

`POST /evaluation/run` — единственный новый POST для кодовых оценок. Разводить
его на `/valuation`, `/unlocks` и `/sector-position` запрещено.

---

# ШАГ 08 — Автоматический источник tokenomics и проверка покрытия

**Цель.** До написания production-парсера доказать фактическими запросами, откуда
автоматически брать календарь разлоков и прогноз разводнения для всей рабочей
выборки.

Старое предположение о бесплатном `https://api.llama.fi/emissions` больше не
используется: endpoint отвечает HTTP 402, официальный Token Unlocks API находится
на `https://pro-api.llama.fi/api/emissions`.

### Проверяемые кандидаты источника

1. Mobula metadata / multi-metadata: в документации заявлен `release_schedule` и
   bulk-запрос нескольких активов.
2. DeFiLlama Pro emissions — опциональный источник при наличии ключа.
3. Messari, CryptoRank или Tokenomist — только как дополнительные адаптеры после
   реальной проверки ответа, условий доступа и лицензии.
4. CoinGecko `circulating_supply`/`total_supply` — только текущий навес и
   историческая эмиссия. Подменять ими будущий календарь 30/90/365 запрещено.

### Одноразовый source spike

Создать `scripts/check-tokenomics-sources.ts`. Скрипт:

- делает реальные запросы к доступным источникам;
- сохраняет сырые ответы через `StoreService.saveRaw`;
- показывает фактическую схему каждого ответа;
- проверяет не меньше 20 разных активов из текущей active selection, включая
  HYPE, AAVE, ARB/OP либо их фактические аналоги в выборке;
- строит coverage по числу токенов и капитализации;
- отдельно считает exact match, mapping failed, source missing и stale;
- проверяет bulk-размер, rate limit, timestamp источника и открываемый source URL;
- не использует тикер как единственный ключ, если источник отдаёт устойчивый ID
  или контракт.

Production-адаптер пишется только после показа результатов spike и утверждения
основного источника. Скрипт удаляется тем же коммитом после переноса проверенных
парсеров в `src/core/tokenomics/`.

### Нормализованный контракт

```ts
export type TokenomicsDataState =
  | 'available'
  | 'known_zero'
  | 'mapping_failed'
  | 'source_missing'
  | 'source_stale'
  | 'source_error';

export interface UnlockEvent {
  date: string;
  tokens: number;
  category: 'team' | 'investors' | 'community' | 'ecosystem' | 'other' | 'unknown';
  sourceUrl: string;
  asOf: string;
}

export interface TokenomicsFacts {
  coingeckoId: string;
  ticker: string;
  provider: string | null;
  providerId: string | null;
  matchedBy: 'coingecko_id' | 'contract' | 'provider_id' | 'symbol' | 'none';
  state: TokenomicsDataState;
  events: UnlockEvent[];
  sourceUrl: string | null;
  asOf: string | null;
  note: string;
}
```

Пустой массив событий не становится `known_zero` автоматически. Ноль допустим,
только если источник явно сообщает полный календарь и отсутствие будущей
эмиссии. Иначе `source_missing`.

**Приёмка.** Показана реальная схема основного источника · показано покрытие
active selection по количеству и капитализации · показаны минимум одна cliff и
одна linear schedule · 402/401/429 различаются · mapping по совпавшему тикеру с
двумя кандидатами отказывается, а не выбирает первый · у каждого принятого числа
есть `sourceUrl` и `asOf`.

**Запрещено.** Писать production-парсер по документации без реального ответа.
Считать `totalSupply − circulating` разводнением следующих 12 месяцев. Делать
ручной ввод обязательным условием прохождения оценки.

**СТОП.**

---

# ШАГ 09 — Единая массовая кодовая оценка

**Цель.** Один POST оценивает все токены текущей композиции фильтров и возвращает
для каждого `valuation`, `tokenomics` и `sectorPosition`.

### Вход

`POST /evaluation/run` всегда читает текущий `UniverseView`. Вход — только строки
с `passed: true`.

- оба фильтра включены → оцениваются survivors `screen → alpha`;
- включён только screen → survivors screen;
- включена только alpha → survivors alpha по полному снимку;
- оба выключены → вся вселенная.

Запрос не принимает список тикеров и не включает фильтры сам.

```ts
export class EvaluationRunDto {
  @ApiPropertyOptional({ example: 'default' })
  profileId?: string;

  @ApiPropertyOptional({ default: false })
  offline?: boolean;

  @ApiPropertyOptional({ default: false })
  refresh?: boolean;
}
```

`offline: true` использует только сохранённые tokenomics facts. `refresh: true`
обходит их суточный кэш, но не обновляет рынок и выручку: для этого уже существует
`POST /universe/prices`.

Прогон занимает глобальный слот `JobService`, потому что tokenomics может ходить
в сеть. Повторный параллельный запуск отвечает 409 с именем текущей задачи.

### Компонент `valuation`

Использует только готовые поля кандидата. Никаких сетевых запросов и повторного
расчёта метрик вселенной.

Проверки против `evaluationProfile.thresholds`:

- известна `revenue12mUsd`;
- выручка не ниже `minAnnualRevenueUsd`;
- капитализация не ниже `minMcapUsd`;
- `pRev` не выше `maxPRev`.

Проверки не меняют universe. Их результат записывается в
`valuation.verdict.passed` и `failedChecks`.

Балл:

```text
100 − 100 × pRev / maxPRev
```

Зажать в 0..100. Нет выручки или P/Rev → `score: null`, не ноль.

Метрики: `mcapUsd`, `fdvUsd`, `revenue12mUsd`, `fees12mUsd`, `pRev`, `fdvRev`,
`takeRatePct`, `tvlUsd`. Все проходят существующий `ValidateService`.

### Компонент `tokenomics`

Автоматически загружает или читает `TokenomicsFacts`, суммирует события на
горизонтах 30/90/365 дней и считает через `money.ts`:

```text
dilution30dPct  = unlockTokens30d  / circulating × 100
dilution90dPct  = unlockTokens90d  / circulating × 100
dilution12mPct  = unlockTokens365d / circulating × 100
netHolderYieldPct = holderYieldPct − dilution12mPct
```

Дополнительно:

- USD-стоимость каждого окна по `priceUsd`;
- ближайшее событие;
- `nextUnlock.costInDailyVolumes = unlockUsd / vol24hUsd`;
- `floatPct` и `fdvToMcap` как отдельные признаки общего навеса;
- источник и дата каждой составляющей.

Балл:

- NHY ≥ 5% → 90..100;
- NHY от 0 до 5% → `50 + NHY × 8`;
- NHY < 0 → `50 + NHY × 2.5`, не ниже 0.

`verdict.dilutionRisk`: `low` < 5%, `medium` 5–15%, `high` > 15%, `unknown`.
`hardFilterFail = true` при подтверждённом отрицательном NHY.

Неполные данные:

- календарь неизвестен → NHY не выдаётся как подтверждённое число;
- holder revenue неизвестна → NHY неизвестен;
- подтверждённый ноль holder revenue остаётся нулём;
- обе части неизвестны → `score: null`;
- отсутствие календаря не заменяется оценкой по FDV/market cap.

### Компонент `sectorPosition`

Общий расчёт перцентилей выносится из `applyAlpha` в чистую функцию, которую
используют и alpha, и evaluation. Две независимые реализации одной формулы
запрещены.

Если alpha включена, evaluation переиспользует уже посчитанный `AlphaView`.
Если alpha выключена, те же перцентили считаются по входу evaluation, но никого
не отсекают и не меняют `ActiveFilterState`.

Результат:

- `sectorScore`;
- `rankInSector`;
- `revenueSharePct`;
- перцентили каждой метрики;
- peers;
- `comparisonAvailable`;
- `selectionApplied`: применялся ли alpha как фильтр.

Роль:

- `leader` — доля выручки ≥ 40% и перцентиль эффективности ≥ 60;
- `overvalued` — перцентиль дешевизны < 30 и перцентиль доли < 50;
- `challenger` — перцентиль эффективности ≥ 50;
- `outsider` — остальное;
- `unknown` — недостаточно peers или метрик.

Малый сектор не получает выдуманный балл. Токен остаётся в оценке с `score: null`
и списком доступных peers.

### Хранение и кэш

Результат сохраняется целиком как один воспроизводимый прогон, а не как тысячи
независимых файлов кодовых агентов:

```text
data/evaluations/<date>/<runId>.json
data/evaluations/latest.json
```

Ключ повторного использования включает:

- `universeVersion`;
- полный hash `activeFilters`;
- hash evaluation profile;
- дату/версию market, revenue и tokenomics facts.

Кодовые вычисления дешёвые, поэтому смена фильтра пересчитывает их, а не пытается
склеить старый прогон по отдельным токенам.

### HTTP

`POST /evaluation/run` возвращает 202 и краткое состояние запуска.

`GET /evaluation/status` показывает progress, inputCount, processed, failures и
последнюю ошибку.

`GET /evaluation/latest` отдаёт envelope с provenance, summary и страницей
кандидатов. `limit` по умолчанию 50, максимум 500.

`GET /evaluation/{token}` возвращает три компонента из последнего прогона. Токен
не входил в тот active selection → 404 с объяснением, а не точечный сетевой сбор.

### Рефакторинг существующего каркаса

- удалить `ScreenerAgent` и его регистрацию в `AGENT`;
- не создавать `UnlocksAgent` и `SectorPositionAgent`;
- переиспользовать `ValidateService` и `metric()`;
- `AgentRunnerService` оставить только для `mechanism` и `critic`;
- обновить Swagger: `GET /agents` больше не показывает кодовые компоненты;
- `BaseAgent` переименовать в `BaseLlmAgent`, когда подключается первый LLM-агент.

**Приёмка.** Все четыре комбинации фильтров дают evaluation ровно по
`status.passed` · один POST создаёт все три компонента · при выключенной alpha
sector position считается, но состав не меняется · повторный GET не ходит в сеть
· отрицательный NHY даёт hard filter · неизвестный календарь не становится нулём
· метрика без source/asOf обнуляется валидатором · список страницами и содержит
`universeVersion`, `builtAt`, `activeFilters`.

**Запрещено.** Создавать три POST endpoint. Называть компоненты агентами. Менять
screen/alpha из evaluation. Исключать строку из evaluation из-за data gap.

**СТОП.**

---

# ШАГ 10 — LLM-сервис со строгой схемой

**Цель.** Единственный разрешённый путь к модели для двух финальных агентов.

`LlmService.structured<T>()` принимает prompt, zod-схему и tool name, вызывает
модель только через tool use, затем обязательно выполняет `schema.parse()`.

Системные правила:

1. Модель не вычисляет числа.
2. Модель не использует память о проекте.
3. Утверждения только по переданным документам и EvaluationRun.
4. Ссылки только из входа.
5. Нет данных → `missing`, а не догадка.
6. Никаких рекомендаций покупать/продавать и ценовых прогнозов.

Используется zod v4 и встроенный `z.toJSONSchema`. Фактический JSON Schema
проверить на совместимость с текущим Anthropic tool input schema реальным
вызовом, а не предположением.

Кэш LLM включает token, имя агента, model, promptVersion, schemaVersion и hash
документов/входа. Профиль фильтра в ключ не входит сам по себе: один и тот же
факт не оплачивается повторно из-за другой выборки.

Клиент создаётся лениво. Без `ANTHROPIC_API_KEY` приложение собирается, а при
вызове отвечает понятной ошибкой с предложением `mock=true`.

`LlmMockService` имеет тот же интерфейс, и каждый результат mock проходит
настоящий `schema.parse()`.

Временный `POST /debug/llm-ping` удалить после проверки.

**Приёмка.** Реальный tool use проходит zod · mock проходит ту же схему · без
ключа нет стектрейса · несовместимый ответ падает на parse · ключ нигде не
логируется · временный endpoint удалён.

**Запрещено.** Свободный текст с последующим JSON.parse. Вызов без системных
правил. Кэш невалидированного объекта.

**СТОП.**

---

# ШАГ 11 — Агент mechanism и документация

**Цель.** Первый настоящий агент объясняет, каким механизмом успех проекта
может передаваться токену. Он работает поверх сохранённой кодовой оценки.

### Вход

`AgentContext` больше не строится из отдельного `SnapshotRow`. В него входят:

- `CandidateEvaluation` из последнего совместимого EvaluationRun;
- исходный `UniverseCandidate`;
- `universeVersion` и `activeFilters` evaluation;
- тексты документации и их URL;
- evaluation profile только как provenance, не как способ менять категории LLM.

Если evaluation отсутствует или не соответствует текущей выборке, агент отвечает
409 с инструкцией вызвать `POST /evaluation/run`.

### Документация

Основной путь — автоматический сбор доступных официальных ссылок, уже сохранённых
в данных проекта/источников. Текст сохраняется вместе с source URL, fetchedAt и
content hash. Неофициальные статьи и поисковые сниппеты не используются как
доказательство механизма.

`POST /manual/docs/{token}` остаётся только необязательным override для случая,
когда официальный документ не удалось получить автоматически. Ranking не должен
требовать, чтобы пользователь вручную заполнил документы для каждого токена.

Нет документации → `score: null`, заполненный `missing`, численные результаты
evaluation остаются доступными, модель не вызывается.

### Схема ответа

Категории:

- `feeSwitchStatus`: none / proposed / voted_not_active / active_unpaid /
  active_paid / unknown;
- `valueRoute`: buyback / burn / cash_distribution / staking_from_revenue /
  staking_from_emissions / mixed / none / unknown;
- `tokenRequired`: required / useful / governance_only / none / unknown;
- качество роста, устойчивость выручки и риск стимулов — только enum-категории;
- `evidence`: цитата/утверждение, sourceUrl и дата документа;
- `confidence`, `missing`.

Модель не выставляет score. Код применяет замороженную таблицу очков.

### Сверка с evaluation

- модель говорит `none`, а holder revenue подтверждённо > 0 → contradiction;
- модель говорит `active_paid`, а holder revenue пуст или ноль → contradiction;
- contradiction домножает confidence на 0.5;
- `hardFilterFail` требует одновременно категориальный провал и подтверждённый
  ноль/отсутствие связи в числах. Одного мнения модели недостаточно.

`POST /agents/mechanism/{token}` сохраняется для точечной проверки. В полном
прогоне агент запускается оркестратором ranking, а не вручную по каждому токену.

**Приёмка.** Без evaluation → 409 · без документации → честный отказ без вызова
модели · с документацией evidence содержит открываемый URL · score считает код ·
contradiction ловит расхождение с holder revenue · другой screen/alpha не вызывает
повторный LLM, если документы и факты те же.

**Запрещено.** Отвечать по памяти. Давать модели числа для вычислений. Делать
ручную документацию обязательной для всей выборки.

**СТОП.**

---

# ШАГ 12 — Агент critic

**Цель.** Второй настоящий агент получает готовую кодовую оценку и результат
mechanism и пытается опровергнуть тезис.

Без совместимых `CandidateEvaluation` и mechanism result агент не запускается.

В модель передаются не полные сырые JSON, а ограниченная выжимка:

- valuation verdict/score/dataQuality/missing;
- tokenomics verdict/score/dataQuality/missing;
- sectorPosition verdict/score/dataQuality/missing;
- mechanism verdict/score/dataQuality/missing;
- источники, уже присутствующие в этих результатах.

Схема сохраняет:

- тезис одной фразой;
- один конкретный killer fact;
- где его проверить;
- falsifiable / successWithoutToken / singleSourceRisk;
- что произойдёт при остановке стимулов;
- liquidity concern;
- confidence in thesis;
- data gaps.

Score считает код: база `confidenceInThesis × 100`, затем замороженные штрафы за
нефальсифицируемость, успех без токена, single-source risk и ликвидность.

`critic` не входит в средневзвешенный композит. На шаге ranking его score станет
множителем.

**Приёмка.** Без prior results → отказ · killer fact конкретен и проверяем ·
whereToCheck указывает на входной источник · общая фраза о рисках не проходит
валидацию/prompt acceptance · повтор использует LLM-кэш.

**Запрещено.** Запускать critic вслепую. Принимать общий текст как killer fact.
Позволять critic менять кодовые метрики.

**СТОП.**

---

# ШАГ 13 — Оркестрация агентов по массовой оценке

**Цель.** Подготовить безопасный массовый запуск двух LLM-агентов, не требуя от
пользователя вызывать per-token endpoints.

Оркестратор читает один совместимый EvaluationRun. Кандидаты не исчезают:

- code hard filter → строка остаётся, LLM не вызывается, причина записывается;
- нет документации → строка остаётся как data gap, LLM не вызывается;
- mechanism доступен → запускается/читается из кэша;
- critic запускается только после mechanism и только для верхушки предварительного
  композита.

Предварительный композит считается по доступным `valuation`, `tokenomics`,
`sectorPosition`, `mechanism` с нормировкой на сумму доступных весов. Critic
получают строки с композитом ≥ 45.

Fan-out LLM через `p-limit`, 3–4 вызова одновременно. Прогон фиксирует input hash
до первого вызова; обновление universe/prices во время LLM-run не подмешивается в
уже начатую работу.

Если число планируемых LLM-вызовов превышает явно заданный порог большого
прогона, ответ до старта показывает estimatedCalls и требует
`confirmLargeRun: true`. Это защита от случайного запуска по всей вселенной при
выключенных фильтрах, а не скрытое требование включить alpha.

**Приёмка.** Evaluation после любой комбинации фильтров принимается · фильтры не
включаются автоматически · code failures и data gaps остаются в результате ·
повтор не вызывает модель заново · большой прогон без подтверждения не стартует и
показывает точное число ожидаемых вызовов.

**Запрещено.** Требовать включённую alpha. Тихо обрезать выборку до N токенов.
Скрывать строки без LLM-результата.

**СТОП.**

---

# ШАГ 14 — Итоговый рейтинг

**Цель.** Один `POST /ranking/run` строит рейтинг из текущего совместимого
EvaluationRun и результатов двух агентов.

### Вход и совместимость

По умолчанию используется `evaluation/latest`. Ranking сравнивает:

- `universeVersion`;
- полный `activeFilters`;
- evaluation profile/hash;
- версии фактов;
- текущий состав active selection.

Несовпадение → 409 с инструкцией повторить `POST /evaluation/run`. Ranking не
пересчитывает фильтры скрытно и не принимает второй profileId, расходящийся с
evaluation.

### Хард-фильтры рейтинга

В watchlist, а не в основной рейтинг, уходят:

- `valuation.verdict.passed === false`;
- `tokenomics.verdict.hardFilterFail === true`;
- `mechanism.verdict.hardFilterFail === true`;
- данные ниже минимального качества, если профиль требует это явно.

Хард-фильтр не удаляет карточку. В ней остаются причина и событие, которое могло
бы вернуть проект в основной рейтинг.

### Композит

```text
base = weightedMean(
  valuation,
  tokenomics,
  sectorPosition,
  mechanism
)

final = base × (0.6 + 0.4 × criticScore / 100)
```

Отсутствующие score не получают ноль; веса нормируются на сумму доступных
компонентов. Если доступных данных недостаточно, composite остаётся null.

### Тиры

- hard filter → watchlist;
- composite null или dataQuality ниже `minDataQuality` → C;
- composite ≥ A и dataQuality ≥ 0.7 → A;
- composite ≥ B → B;
- остальное → C.

Внутри тира порядок условный. API не выдаёт инвестиционных рекомендаций.

### Карточка

Карточка содержит:

- universe/version/filter provenance;
- valuation block;
- tokenomics: float, dilution, unlock pressure, NHY;
- sector position: group, peers, percentiles, role;
- mechanism и contradictions;
- critic;
- data quality, missing, hard-filter reasons;
- composite и tier.

`POST /ranking/run` работает в фоне и возвращает started/status. В теле остаются
только `mock`, `noCritic`, `confirmLargeRun` и опциональный `sector`; конфигурация
оценки и отбора берётся из EvaluationRun.

**Приёмка.** Ranking использует ровно кандидатов evaluation · все комбинации
screen/alpha поддерживаются · watchlist не скрыт · повтор использует кэши ·
activeFilters и universeVersion присутствуют в ответе · critic применён
множителем · строка без score не получает ноль.

**Запрещено.** Требовать alpha. Передавать скрытый профиль прямо в ranking.
Усреднять hard filters. Выбрасывать unrankable/data-gap survivors.

**СТОП.**

---

# ШАГ 15 — Отчёты, sensitivity и сквозная приёмка

**Цель.** Доказать, что система удобна в Swagger, воспроизводима и не требует
ручного обхода токенов.

### Эндпоинты

- `GET /ranking/latest` — provenance, сводка тиров, watchlist и страница карточек;
- `GET /ranking/report/{date}` — сохранённый markdown;
- `POST /ranking/sensitivity` — 25 пересчётов весов ±30% без сети и без LLM;
- журнал `reports/journal.md` — дата, universeVersion, activeFilters, evaluation
  runId, тиры A/B и композиты.

### Основной Swagger-сценарий

1. При необходимости `POST /universe/refresh`, дождаться готовности.
2. При необходимости `POST /universe/prices`.
3. Включить оба фильтра, один или ни одного через существующие endpoints.
4. Один раз вызвать `POST /evaluation/run`.
5. Посмотреть массовый результат в `GET /evaluation/latest` либо один токен в
   `GET /evaluation/{token}`.
6. Вызвать `POST /ranking/run`; mechanism и critic запускаются автоматически
   только там, где есть входные данные.
7. Прочитать `GET /ranking/latest` или отчёт.

Нормальный сценарий не содержит ручного ввода разлоков, последовательного запуска
valuation/tokenomics/sectorPosition и вызова агентов по каждому тикеру.

### Сквозная приёмка

- screen on + alpha on → evaluation input равен `status.passed`;
- screen on + alpha off → другой input, всё работает;
- screen off + alpha on → alpha-only input, всё работает;
- оба off → вся вселенная оценивается, фильтры не включаются автоматически;
- три кодовых компонента создаются одним POST;
- tokenomics автоматически собирается для всей группы;
- повторный evaluation не платит за свежие источники заново;
- повторный ranking не вызывает LLM заново;
- смена фильтров делает старый evaluation несовместимым, но не удаляет его;
- токены без tokenomics/docs остаются видимыми как data gaps;
- списки отдаются страницами;
- каждый отчёт содержит `universeVersion`, `builtAt`, `activeFilters`, runId и
  источники;
- открытая вручную ссылка подтверждает минимум одно число valuation, одно событие
  tokenomics и одно evidence mechanism;
- `npm run build` и полный `npm test` зелёные.

### Дисклеймер

Во всех ranking/evaluation ответах и markdown:

> Исследовательский инструмент. Не является инвестиционной рекомендацией. Каждое
> число проверяется по указанному источнику.

**СТОП. Проект готов.**

---

## Подводные камни оставшихся шагов

**Evaluation не третий фильтр.** `valuation.passed` и tokenomics hard filter
влияют только на итоговый ranking/watchlist. Они не меняют universe status и не
подменяют обратимые screen/alpha.

**Alpha выключена — sector position всё равно существует.** Сравнение считается
как оценка, но никого не удаляет. Иначе один из трёх компонентов исчезал бы при
законной комбинации фильтров.

**Пустой календарь неоднозначен.** Только полный источник имеет право сказать
`known_zero`; пустой/непокрытый ответ — `source_missing`.

**Разлок и эмиссия могут пересекаться.** Если источник одновременно отдаёт
vesting events и ежедневную эмиссию, перед суммированием нужно доказать, что это
разные потоки. Иначе dilution удвоится правдоподобно.

**Тикер не идентификатор.** Один символ у двух активов — mapping failure, а не
основание выбрать строку с большей капитализацией.

**Историческое supply не прогноз.** Рост circulating за прошлый год можно
показать отдельной метрикой, но нельзя подставлять в scheduled dilution 12m.

**Кодовая оценка не нуждается в per-token кэше.** Она дешёвая и зависит от всей
группы сравнения; сохраняется один run с полным provenance.

**LLM-кэш зависит от входа, не от фильтра.** Изменение screen/alpha само по себе
не оплачивает повторный mechanism, если документы и факты токена не изменились.

**Большая выборка не запрещена.** При выключенных фильтрах evaluation обязана
работать по всей вселенной. Защита нужна только перед дорогими LLM-вызовами и
должна показывать estimatedCalls.

**Ни один компонент не скрывает data gaps.** Неизвестная tokenomics, малый сектор
или отсутствие документов отражаются в результате, а не удаляют токен молча.

**Имена в профиле должны совпадать с композитом.** `sectorPosition` используется
одинаково в типах, weights и ranking map; старые ключи `screener`/`unlocks`
удаляются одной утверждённой миграцией.
