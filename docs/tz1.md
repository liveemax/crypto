# ТЗ для Codex: кодовый продукт, один шаг за одно окно

Этот документ заменяет активную часть `docs/tz.md` после выполненного шага 11.
Шаги ниже специально раздроблены так, чтобы **один подшаг целиком выполнялся в
одном окне Codex** и после него репозиторий оставался собираемым и тестируемым.

Инварианты, границы слоёв, ловушки прода и правила правок находятся в
`CLAUDE.md`. Инструкции исполнителю — в `AGENTS.md`. При расхождении прав
`CLAUDE.md`; противоречие нельзя исправлять молча.

---

## Как запускать Codex

В новом окне передавать одну команду:

```text
Выполни только ШАГ <номер> из docs/tz1.md.
Прочитай AGENTS.md и CLAUDE.md. Соседние шаги не начинай.
После полной приёмки остановись и дай отчёт в формате шага.
```

Пример: `Выполни только ШАГ 12.2 из docs/tz1.md`.

Нельзя просить «сделай шаги 12–16». Номер с точкой — самостоятельный шаг, а не
часть работы, которую разрешено продолжить автоматически.

---

## Обязательный протокол каждого окна Codex

### До правок

1. Полностью прочитать `AGENTS.md` и `CLAUDE.md`, затем только выбранный шаг и
   перечисленные у него зависимости.
2. Выполнить `git status --short`. Чужие незавершённые правки не откатывать и
   не форматировать по дороге.
3. Через `rg` найти реальные определения типов, DTO, сервисов и тестов. Не
   угадывать путь или текущее содержимое файла по этому ТЗ.
4. Сопоставить требования с кодом. Если замороженный контракт или инвариант
   мешает реализации — статус `BLOCKED`, описание конфликта и одно конкретное
   решение; код не менять.
5. Составить короткий план только выбранного шага. Будущие контроллеры,
   зависимости, типы и заглушки в план не включать.

### Во время правок

- Реализовать только одну публичную возможность или одну законченную миграцию,
  названную шагом.
- Бизнес-логика — чистые функции; сеть, диск и Nest-контроллеры остаются на
  границах. `core` не импортирует `api`.
- Деньги и проценты считать через `money.ts`; неизвестное хранить как `null` и
  типизированный `missing`, а не как ноль.
- Метрика участвует в формуле только после проверки `value + sourceUrl + asOf`.
- Тесты не ходят в сеть и живут только в `test/`.
- Новая защита получает негативный тест. Новый HTTP-контракт получает DTO,
  Swagger-пример и e2e-тест в том же шаге.
- Если часть требования уже реализована, её не переписывать ради видимости
  работы: доказать тестом или поиском. Полностью готовый шаг завершается как
  `DONE_NO_CHANGES` с той же приёмкой.

### Команды перед завершением

Для каждого шага обязательны:

```bash
git diff --check
npm run build
npm test -- --runInBand
```

Если менялся HTTP-контракт, дополнительно:

```bash
npm run test:e2e -- --runInBand
```

Сначала разрешено гонять один целевой spec. Финальный полный прогон пропускать
нельзя. Ошибка существующего теста — не повод удалять тест или ослаблять
ожидание без доказанного изменения контракта.

### Допустимые финальные статусы

- `DONE` — код изменён, вся приёмка зелёная.
- `DONE_NO_CHANGES` — требование уже выполнено, вся приёмка доказана.
- `BLOCKED` — нет runtime-данных, обнаружено противоречие или отсутствует
  необходимый доступ. Частично готовый шаг нельзя называть выполненным.
- `FAILED_ACCEPTANCE` — реализация сделана, но хотя бы одна проверка не прошла.
  К следующему шагу переходить нельзя.

При `BLOCKED` Codex даёт **один готовый блок команд** или один точный вопрос,
который снимает блокировку. Он не продолжает работу предположениями.

### Формат итогового ответа Codex

```text
СТАТУС: DONE | DONE_NO_CHANGES | BLOCKED | FAILED_ACCEPTANCE

РЕЗУЛЬТАТ
- что изменилось и какой пользовательский сценарий теперь работает

ФАЙЛЫ
- созданные
- изменённые
- удалённые

ПРИЁМКА
- [x] критерий — доказательство: тест/команда/измеренное значение
- [ ] критерий — причина, если не пройден

КОМАНДЫ
- команда — exit code/result

РИСКИ И EDGE CASES
- только оставшиеся, без пересказа сделанного

СТОП. Ожидаю подтверждения следующего шага.
```

Фразы «должно работать», «тесты добавлены» и «вроде готово» доказательством не
являются. Для численного критерия приводится полученное число; для негативного
контракта — имя теста и фактический HTTP-статус/ошибка.

---

## Границы продукта

Это исследовательский сервис, не торговая система. Пользователь работает через
Swagger на `/api` и получает проверяемые числа, источники, даты, уровень
качества данных и честные отказы.

Продукт на этом этапе **полностью кодовый**. LLM не вызывается, ключ модели не
нужен. `mechanism` и `critic` отложены до появления проверенного корпуса
документов и benchmark качества.

Продукт не утверждает:

- устойчив ли механизм возврата ценности и когда его могут отключить;
- идёт доход держателю из комиссий или из новой эмиссии;
- нужен ли токен бизнесу;
- какой конкретный факт полностью опровергнет тезис.

Вместо догадки каждая карточка содержит `notEvaluated` с причиной
`mechanism_not_evaluated` и показывает измеренные рядом факты:
`holdersRevenue12mUsd`, `payoutRatioPct`, `holderYieldPct`.

### Конвейер

```text
snapshot → [screen?] → [alpha?] → evaluation → ranking
```

- `screen` — абсолютные правила профиля;
- `alpha` — top-N крупнейших сравнимых бизнесов только в перенасыщенной нише;
- оба фильтра независимы и обратимы; можно включить оба, один или ни одного;
- active selection всегда получается через
  `view.candidates.filter((candidate) => candidate.passed)`;
- evaluation и ranking не включают фильтры и не меняют `ActiveFilterState`;
- сеть или платная операция → `202` и `JobService`; локальный расчёт → `200`;
- evaluation и ranking локальны, синхронны и не занимают слот задачи.

### Формулы, которые нельзя менять по дороге

```text
businessScaleScore = 0.50 × percentile(tvlUsd, higher_better)
                   + 0.50 × percentile(revenue12mUsd, higher_better)
```

Обе оси обязательны; для каждой в `comparisonGroup` нужно минимум три
подтверждённых значения.

```text
valuationScore = weightedMean(
  pRevPercentile          × 0.40,
  pFeesPercentile         × 0.20,
  fdvRevPercentile        × 0.20,
  holderYieldPercentile   × 0.10,
  revenuePerTvlPercentile × 0.10
)
```

Гейт valuation: известен `pRev` или `fdvRev`, доступны минимум две оси и сумма
исходных доступных весов не ниже `0.60`. Перцентиль каждой оси требует минимум
три подтверждённых значения в нише.

```text
weights = { tokenomics: 0.35, valuation: 0.35, sectorPosition: 0.30 }
base    = weightedMean(доступные компоненты)
final   = clamp(base - flagPenalty, 0, 100)
```

Композит существует только при минимум двух компонентах и `weightSum >= 0.55`.
Отсутствующий компонент не получает ноль. `componentsUsed` и `weightSum`
обязательны рядом с итогом.

### Контракты API

- список: `context + pagination + items`, `limit=50`, максимум `200`;
- тяжёлый ответ: `view=summary|full`, default меньше `300 КБ`;
- ошибка: `code`, `message`, `details`, `nextAction`;
- идентификатор: `coingeckoId`; неоднозначный тикер → `409` со списком;
- известный тикер не получает `404` только из-за отсутствия в active selection;
- проценты — в процентах, деньги — USD, неизвестное — `null`;
- `DataTier`: `yield | economics | pool | rejected`;
- `RankTier`: `A | B | C | watchlist`;
- Swagger-теги: `system`, `universe`, `evaluation`, `ranking`, `manual`, `config`.

Не создавать: `/documents/refresh`, `/analysis/mechanism`, `/analysis/critic`,
`/manual/docs`, `/ranking/plan`. Без LLM у них нет потребителя.

---

# ШАГ 11.5A — Удалить остатки LLM и синхронизировать контракт

**Зависимости:** выполнен шаг 11 из `docs/tz.md`.

**Результат окна:** репозиторий не содержит рабочего или публичного пути к LLM;
кодовая функциональность не меняется.

### Сделать

1. Удалить, только если существуют: `src/core/llm/`, debug LLM controller/DTO,
   LLM-тесты и их регистрации.
2. Удалить `@anthropic-ai/sdk`, `ANTHROPIC_API_KEY`, `MODEL`, `llmAgents`,
   `AGENT_NAMES`, `BaseAgent`, `AgentResult` из типов, zod, DTO, профилей,
   Swagger и тестов.
3. Сохранить фабрику `badGateway` и правильный порядок веток
   `ApiExceptionFilter`: это общий HTTP-контракт, а не LLM-код.
4. Синхронизировать короткие утверждения в `CLAUDE.md`: продукт кодовый,
   `mechanism`/`critic` отложены, активное ТЗ — `docs/tz1.md`.

### Не делать

- Не менять формулы, веса, alpha, evaluation или HTTP-ответы кодовых путей.
- Не добавлять пустой `LlmPort`, будущие модули или закомментированный код.
- Не чинить пункты «Открытого долга».

### Обязательная приёмка

#### Запросы, которые пользователь передаёт Codex

Выполнить в Swagger после реализации шага:

1. `GET /config/profiles` — передать HTTP-статус и один профиль целиком. В
   профиле не должно быть `llmAgents`.
2. `GET /api/openapi.json` — передать только найденные совпадения по словам
   `llm`, `anthropic`, `agent`, `mechanism`, `critic`, `debug`, `analysis`. Для
   успешной приёмки список LLM/debug paths должен быть пустым. До шага 13
   `mechanism` ещё может встретиться только как старый ключ весов; это нужно
   отдельно отметить, но не принимать за живой endpoint.
3. `GET /agents`, `POST /debug/llm-ping` с телом `{}` и
   `POST /analysis/mechanism/AAVE` с телом `{}` — передать статус и тело каждого
   ответа. Ожидается нормализованный `404`, а не HTML и не stack trace.

В Codex вставить ответы одним сообщением с заголовком
`РУЧНАЯ ПРИЁМКА ШАГА 11.5A`. Секреты и полный OpenAPI-файл не отправлять.

- [ ] `rg -ni "anthropic|llmAgents|AGENT_NAMES|BaseAgent|AgentResult|ANTHROPIC_API_KEY" src test package.json .env.example` не находит живого кода.
- [ ] Swagger не содержит LLM/debug/analysis paths.
- [ ] Удалённые LLM paths отвечают `404`, если они раньше существовали.
- [ ] Помимо намеренно удалённых LLM-полей, ответы существующих кодовых
      эндпоинтов не изменились.
- [ ] `git diff --check`, build, unit tests и e2e зелёные.

**СТОП.**

---

# ШАГ 11.5B — Зафиксировать baseline на реальных runtime-данных

**Зависимости:** 11.5A. Нужны актуальные файлы в `data/`; их нет в git по
определению.

**Результат окна:** `reports/baseline-<YYYY-MM-DD>.md` с измеренным исходным
состоянием. Новой production-функциональности нет.

### Если runtime-данных нет

Остановиться `BLOCKED` до правок. Перечислить точные ожидаемые файлы, найденные
по `StoreService`, и дать один блок команд для пользователя, который покажет
`ls`, версии снапшотов и `/status`. Придумывать baseline или подменять его
фикстурой запрещено.

### Сделать

Одноразовый `scripts/baseline.ts` читает данные через существующие парсеры и
сервисы, печатает и сохраняет:

- `universeVersion`, `builtAt`, размер снимка;
- active selection для четырёх комбинаций screen/alpha;
- распределение `DataTier`;
- покрытие revenue, TVL, unlocks, overhang по каждому `dataState`;
- число групп с минимум тремя подтверждёнными значениями отдельно для
  `tvlUsd`, `revenue12mUsd`, `pRev`, `pFees`, `fdvRev`, `holderYieldPct`,
  `revenuePerTvlPct`;
- количество сравнимых строк и групп.

Скрипт удалить тем же изменением после успешного запуска. Отчёт остаётся в
игнорируемом `reports/` и прикладывается ссылкой в ответе Codex.

### Обязательная приёмка

#### Запросы, которые пользователь передаёт Codex

До начала шага выполнить:

1. `GET /status` — передать полный JSON.
2. `GET /universe?offset=0&limit=1&view=summary` — передать `context` и
   `pagination`; саму тяжёлую строку можно не копировать.
3. `GET /universe/coverage` — передать полный JSON покрытия.

Если `status.job.state` показывает работающую задачу, повторять только
`GET /status` до конечного состояния и передать последний ответ. В сообщении
Codex отдельно написать, какой профиль считать baseline (`deep-value` по
умолчанию). Если любой запрос отвечает, что вселенной нет, сначала нужен
`POST /universe/refresh`, а шаг получает статус `BLOCKED` до окончания задачи.

- [ ] Все числа в отчёте имеют общий `universeVersion`, `builtAt` и профиль.
- [ ] Четыре комбинации фильтров посчитаны из одного снимка.
- [ ] Знаменатель покрытия указан явно: full universe и active selection не
      смешаны.
- [ ] Суммы распределений сходятся с соответствующим total.
- [ ] Одноразового скрипта нет в финальном diff.
- [ ] build и полный unit test зелёные.

**СТОП.**

---

# ШАГ 12.1 — Единый business scale для alpha и sectorPosition

**Зависимости:** 11.5B и его baseline.

**Результат окна:** alpha отвечает только на вопрос «кто крупнейший бизнес в
нише»; `sectorPosition` использует ту же чистую функцию.

### Сделать

1. До сравнения построить verified view. `tvlUsd` и `revenue12mUsd` входят в
   столбец только с валидными `sourceUrl` и `asOf`; отброшенное/устаревшее число
   не влияет ни на себя, ни на конкурентов.
2. Оставить две оси с весами `0.50/0.50`; обе обязательны. Минимум значений по
   каждой оси — `3`.
3. Создать один источник истины `businessScalePositions()` для перцентилей,
   долей и мест. Alpha использует его для top-N; `sectorPosition` — для вывода
   без отсева даже при выключенной alpha.
4. Оставить `perSector=5`. Ненасыщенная ниша никого не режет. Несравнимый
   кандидат остаётся data gap и не объявляется последним.
5. Результат содержит `businessScaleScore`, `rankInSector`, `tvlRank`,
   `revenueRank`, `tvlRanked`, `revenueRanked`, `tvlSharePct`,
   `revenueSharePct`, `alphaQualified`, `alphaStatus`, `peers`, percentiles и
   provenance.
6. `alphaStatus`: `sector_leader | outranked | insufficient_data |
   sector_not_saturated | missing_sector`.
7. Tie-break: revenue DESC, TVL DESC, `coingeckoId` ASC.
8. Мигрировать `sectorScore` → `businessScaleScore` во всех затронутых типах и
   тестах. Не оставлять alias или двойное поле.

### Обязательная фикстура

В одной группе минимум: `LARGE` (максимальные TVL/revenue), `MID`, `SMALL`,
`NOSRC` (правдоподобно большие числа без provenance), `MISSING_AXIS`.

### Обязательная приёмка

#### Запросы, которые пользователь передаёт Codex

Выполнить последовательно:

1. `POST /universe/screen` с телом `{"enabled": false}`.
2. `POST /universe/alpha` с телом
   `{"enabled": true, "profileId": "deep-value"}`.
3. `POST /evaluation/run` с телом
   `{"profileId": "deep-value", "refresh": true}`.
4. `GET /evaluation/latest?offset=0&limit=50&view=full`.
5. `GET /universe/data-gaps?offset=0&limit=50`.
6. Выбрать из ответа одного `sector_leader` и одного
   `insufficient_data`, затем выполнить `GET /evaluation/{token}` для каждого.
7. Выключить alpha: `POST /universe/alpha` с телом `{"enabled": false}`;
   повторить `POST /evaluation/run` с `refresh:true` и
   `GET /evaluation/{token}` для прежнего лидера.

Передать Codex: ответы POST, обе карточки, `context`, `inputCount`, alpha status,
rank/score, provenance двух осей и карточку лидера после выключения alpha.
Полный список из сотен строк не передавать.

- [ ] LARGE получает rank 1 и лучший `businessScaleScore`.
- [ ] NOSRC не получает score и не меняет перцентили остальных.
- [ ] Нет TVL или revenue → `insufficient_data`, `alphaQualified=false`.
- [ ] Два подтверждённых значения → percentile и score `null`.
- [ ] В насыщенной нише режутся только сравнимые ниже top-5; data gaps остаются.
- [ ] При alpha off `sectorPosition` совпадает с результатом общей функции.
- [ ] `rg -n "sectorScore" src test` пуст.
- [ ] Чистая функция покрыта позитивными и негативными unit-тестами; build и
      полный test зелёные.

### Запрещено

Цена, market cap, `pRev`, `pFees`, `fdvRev`, yield и efficiency не определяют
размер бизнеса. Fees не заменяют отсутствующую revenue.

**СТОП.**

---

# ШАГ 12.2 — Секторный valuation

**Зависимости:** 12.1.

**Результат окна:** valuation отвечает на вопрос «дорого или дёшево относительно
прямых конкурентов», не дублируя business scale.

### Сделать

1. `AnalysisProfile` получает `valuation.rankBy` с явными полями, направлениями
   и весами формулы из раздела «Границы продукта». Сумма весов валидируется как
   `1`; порядок массива не считается весом.
2. Для `pRev`, `pFees`, `fdvRev` направление `lower_better`; для
   `holderYieldPct`, `revenuePerTvlPct` — `higher_better`.
3. Каждый столбец строится только из подтверждённых метрик и требует минимум
   три значения в `comparisonGroup`.
4. Реализовать гейт: основной `pRev|fdvRev`, минимум две оси,
   `availableWeight >= 0.60`. Только после гейта нормировать доступные веса.
5. В `verdict`/ответе показать `availableMetrics`, `missingMetrics`,
   `availableWeight`, `valuationRank`, `percentiles`, formula version.
6. Абсолютные `minMcapUsd`, `minAnnualRevenueUsd`, `maxPRev` оставить checks в
   `verdict` и screen. Они не добавляют очки второй раз.
7. `tvlUsd`, revenue, fees и holder revenue остаются отображаемыми фактами, но
   не повышают `valuationScore` напрямую.

### Обязательная фикстура

`LARGE` — крупнейший и дорогой; `CHEAP` — меньший, но с лучшими pRev/pFees;
`MID`; `NOSRC`; кандидат только с одной valuation-осью.

### Обязательная приёмка

#### Запросы, которые пользователь передаёт Codex

Выполнить на полной вселенной без фильтров:

1. `POST /universe/screen` — `{"enabled": false}`.
2. `POST /universe/alpha` — `{"enabled": false}`.
3. `POST /evaluation/run` —
   `{"profileId": "deep-value", "refresh": true}`.
4. `GET /evaluation/latest?offset=0&limit=200&view=summary`.

В summary найти одну `comparisonGroup`, где минимум три строки имеют valuation.
Внутри неё выбрать:

- токен с лучшим `businessScaleScore`;
- другой токен с лучшим `valuation.score`.

Для обоих выполнить `GET /evaluation/{token}` и передать Codex полные ответы.
Если такого расхождения в живых данных нет, передать summary выбранной группы и
написать `ЖИВОГО КЕЙСА LARGE/CHEAP НЕТ`; это не заменяет обязательную тестовую
фикстуру и не разрешает придумывать пример.

- [ ] LARGE остаётся лидером business scale, CHEAP получает лучший valuation.
- [ ] NOSRC не влияет на собственный score и перцентили остальных.
- [ ] Одна ось или вес `<0.60` → `score:null` с конкретным `missing`.
- [ ] В группе из двух подтверждённых значений перцентиль `null`.
- [ ] Одинаковый score из разного числа осей различим по метаданным.
- [ ] Изменение абсолютного screen меняет состав, но не формулу valuation.
- [ ] Unit tests, build и полный test зелёные.

### Запрещено

Считать балл до provenance validation; использовать абсолютный P/Rev как весь
valuation; подставлять ноль; смешивать scale и cheapness.

**СТОП.**

---

# ШАГ 12.3 — Совместимость, reuse и публичные контракты шага 12

**Зависимости:** 12.2.

**Результат окна:** новые формулы проходят через evaluation, сохранение, DTO и
Swagger без старых полей и без неверного reuse.

### Сделать

1. `inputHashes.perToken` продолжает определять только покомпонентные факты
   tokenomics. `inputHashes.comparative` включает состав групп, конфигурацию и
   версии business scale/valuation.
2. При смене screen/alpha переиспользовать tokenomics и пересчитывать valuation
   с sectorPosition. Ответ явно показывает `reused`/`recomputed` по компонентам.
3. Мигрировать типы, DTO, Swagger examples, summary/full views и сохранённый
   `EvaluationRun`; старых полей и старой версии формулы нет.
4. Профиль из `GET /config/profiles` должен без ручной очистки проходить обратно
   в POST DTO/zod.
5. Не читать встроенные `passed` из снимка: кандидаты берутся только из текущего
   composed view.

### Обязательная приёмка

#### Запросы, которые пользователь передаёт Codex

Проверить четыре состояния. После настройки каждого состояния выполнить
`POST /evaluation/run` с телом
`{"profileId": "deep-value", "refresh": true}` и сохранить ответ.

| Состояние | `POST /universe/screen` | `POST /universe/alpha` |
|---|---|---|
| off/off | `{"enabled":false}` | `{"enabled":false}` |
| on/off | `{"enabled":true,"profileId":"deep-value"}` | `{"enabled":false}` |
| off/on | `{"enabled":false}` | `{"enabled":true,"profileId":"deep-value"}` |
| on/on | `{"enabled":true,"profileId":"deep-value"}` | `{"enabled":true,"profileId":"deep-value"}` |

Для состояния on/on сразу повторить `POST /evaluation/run` без `refresh`, затем
выключить только alpha и снова выполнить run без `refresh`. Передать Codex из
каждого ответа: `context.activeFilters`, `inputCount`, `evaluatedCount`,
`inputHashes`, `reuse`, `pagination.total`, formula versions и warnings.
Дополнительно передать ответ
`GET /evaluation/latest?offset=0&limit=50&view=summary` и фактический размер
этого ответа в байтах.

- [ ] Неизменный ввод повторно использует совместимые компоненты.
- [ ] Смена любого фильтра: tokenomics reused, два comparative компонента
      recomputed.
- [ ] Четыре комбинации фильтров дают согласованные `inputCount` и status.passed.
- [ ] В сохранённом run есть версии обеих формул и оба input hash.
- [ ] `rg -n "sectorScore" src test` пуст; Swagger показывает
      `businessScaleScore` и metadata valuation.
- [ ] Summary не тащит тяжёлые percentiles/provenance; full их сохраняет.
- [ ] default response не превышает 300 КБ на e2e fixture.
- [ ] build, unit и e2e зелёные.

**СТОП.**

---

# ШАГ 12.4 — Живая приёмка формул и распределение

**Зависимости:** 12.3. Нужны runtime-данные того же `universeVersion`, что в
baseline. Если их нет — `BLOCKED` до правок.

**Результат окна:** `reports/step-12-acceptance-<date>.md`; production-код не
меняется, кроме отдельного согласованного исправления найденного бага.

### Измерить

- четыре комбинации screen/alpha и точное равенство входа evaluation полю
  `status.passed`;
- сколько строк получили valuation, business scale, оба и ни одного;
- распределение причин `score:null`;
- reuse после смены фильтра;
- один реальный LARGE и один реальный CHEAP в одной нише;
- вручную открыть ссылки TVL и revenue лидера и записать URL, `asOf`, число из
  ответа и подтверждение страницы.

### Обязательная приёмка

#### Запросы, которые пользователь передаёт Codex

1. `GET /status` — полный JSON перед началом измерения.
2. Для каждой из четырёх комбинаций из шага 12.3 выполнить
   `POST /evaluation/run` с `{"profileId":"deep-value","refresh":true}`.
3. `GET /evaluation/latest?offset=0&limit=200&view=summary` — передать context,
   pagination и распределение score/null, а не весь массив, если он большой.
4. Для выбранных LARGE и CHEAP выполнить `GET /evaluation/{token}`.
5. Открыть `sourceUrl` TVL и revenue лидера в браузере и передать Codex четыре
   значения: URL, `asOf`, число из API, подтверждает ли открытая страница это
   число или исходный ряд.

В сообщении обязательно указать один общий `universeVersion`, `builtAt`, профиль
и active filters. Ответы от разных снимков смешивать нельзя.

- [ ] Все измерения называют `universeVersion`, `builtAt`, profile и filters.
- [ ] Лидер масштаба подтверждён TVL и revenue; дешёвый конкурент выигрывает
      valuation, если такой кейс есть. Отсутствие кейса фиксируется честно.
- [ ] Неподтверждённые числа не присутствуют в ranked denominators.
- [ ] Числа распределения сходятся с inputCount.
- [ ] build и полный test остаются зелёными.

**СТОП.**

---

# ШАГ 13 — Три веса и видимый `notEvaluated`

**Зависимости:** 12.3. Живой отчёт 12.4 желателен, но не нужен для кода.

**Результат окна:** профиль и evaluation больше не обещают LLM-компонент; веса
трёх кодовых вопросов фиксированы явно.

### Сделать

1. Мигрировать `weights` на точные ключи и значения:
   `tokenomics:0.35`, `valuation:0.35`, `sectorPosition:0.30`.
2. `GET /config/thresholds`, встроенные профили, типы, zod, DTO, Swagger и e2e
   отдают только эти три ключа. Не использовать свободный `Record<string,...>`,
   если он позволяет незаметный четвёртый ключ.
3. Добавить в `EvaluationRun` и кандидата:

```json
{
  "id": "mechanism",
  "why": "Механизм возврата ценности требует чтения документации протокола",
  "whatWeMeasureInstead": [
    "holdersRevenue12mUsd",
    "payoutRatioPct",
    "holderYieldPct"
  ]
}
```

4. Не добавлять здесь `composite()` или ranking-заглушки: гейт композита
   реализуется сразу с реальным потребителем в шаге 15.1.

### Обязательная приёмка

#### Запросы, которые пользователь передаёт Codex

1. `GET /config/thresholds` — передать полный JSON.
2. `GET /config/profiles` — передать один профиль целиком и список ключей
   `weights` у всех профилей.
3. Скопировать полученный профиль без изменений в
   `POST /universe/screen` с телом
   `{"enabled":true,"profile":<ПОЛУЧЕННЫЙ_ПРОФИЛЬ>}`; передать статус и тело.
4. `POST /evaluation/run` —
   `{"profileId":"deep-value","refresh":true}`.
5. `GET /evaluation/latest?offset=0&limit=1&view=full` — передать полный ответ.

Codex должен увидеть три точных веса, сумму `1`, отсутствие `llmAgents` и
`mechanism` как весового компонента, а также `notEvaluated` в evaluation.

- [ ] Поиск старых весов и LLM-ключей пуст.
- [ ] Сумма весов валидируется как `1`.
- [ ] `GET /config/thresholds` и profile round-trip содержат три точных ключа.
- [ ] `notEvaluated` виден в evaluation summary/full в согласованной форме.
- [ ] Никакого `score:0` вместо отсутствующего mechanism.
- [ ] build, unit и e2e зелёные.

### Запрещено

Молча перенормировать старые веса; вводить абсолютный fallback; создавать
неиспользуемый ranking-модуль.

**СТОП.**

---

# ШАГ 14.1 — Ручной override стимулов с provenance

**Зависимости:** 13.

**Результат окна:** необязательные стимулы можно сохранить и прочитать массово
или по токену, но число без источника не принимается.

### HTTP-контракт

`POST /manual/overrides/{token}` и `GET /manual/overrides/{token}`.

```jsonc
{
  "incentives12mUsd": 1200000,
  "sourceUrl": "https://official.example/report",
  "asOf": "2026-08-01T00:00:00.000Z"
}
```

`incentives12mUsd >= 0`: подтверждённый ноль допустим и отличается от
неизвестного. `sourceUrl` — только http/https; `asOf` — ISO даты источника, не
время записи. Запись хранит `origin`, `createdAt`, `coingeckoId` и ticker.

Если появятся manual и API значения одной семантики и различаются больше чем в
два раза, resolver сохраняет оба в provenance, добавляет note и выбирает API.
Отсутствие API сегодня не подменяется нулём.

### Обязательная приёмка

#### Запросы, которые пользователь передаёт Codex

Для `<TOKEN>` использовать реальный тикер или `coingeckoId`. Для успешной записи
нужны настоящий официальный `<SOURCE_URL>` и дата этого источника
`<SOURCE_AS_OF>`; тестовое выдуманное происхождение сохранять нельзя.

1. `POST /manual/overrides/<TOKEN>`:
   `{"incentives12mUsd":1200000,"sourceUrl":"<SOURCE_URL>","asOf":"<SOURCE_AS_OF>"}`.
2. `GET /manual/overrides/<TOKEN>` — передать полный ответ.
3. Повторить GET по второй форме идентификатора: ticker и `coingeckoId` должны
   вернуть одну запись.
4. Негативный запрос без ссылки:
   `POST /manual/overrides/<TOKEN>` с
   `{"incentives12mUsd":1200000,"asOf":"<SOURCE_AS_OF>"}`.
5. Негативный запрос с `incentives12mUsd:-1` и валидными source/asOf.
6. Только если официальный источник подтверждает нулевые стимулы — запрос с
   `incentives12mUsd:0`. Ноль ради теста в рабочие данные не записывать.

Передать Codex HTTP-статус и тело всех ответов, отдельно отметив поведение
повторной записи: replace или новая версия.

- [ ] Валидная запись читается по ticker и `coingeckoId` как один объект.
- [ ] Неоднозначный ticker → `409` со списком; неизвестный → нормализованная 4xx.
- [ ] Без `sourceUrl`, без `asOf`, с неверным URL/датой или отрицательным числом
      → `400` с `code` и `nextAction`.
- [ ] Подтверждённый ноль сохраняется; неизвестное остаётся `null`.
- [ ] Повторная запись имеет детерминированную семантику replace/version,
      закреплённую тестом; дубликаты не возникают молча.
- [ ] DTO, Swagger, unit/e2e, build и full test зелёные.

**СТОП.**

---

# ШАГ 14.2 — Кодовые флаги риска

**Зависимости:** 14.1.

**Результат окна:** evaluation считает проверяемые риск-флаги и суммарный
штраф без сети; ranking позже только применит готовый результат.

### Сделать

- `turnoverPct > 50` → `high_turnover`, −10;
- `turnoverPct < 0.5` → `illiquid`, −10;
- неизвестный turnover → флага нет, `turnoverPct` добавлен в `missing`;
- `incentiveAdjustedRevenue = revenue12mUsd - incentives12mUsd` через
  `money.ts`;
- отрицательный результат → `negative_after_incentives`, −10 и note;
- неизвестные стимулы → `incentives12mUsd` в `missing`, ноль не подставляется;
- сумма штрафов ограничена 20, независимо от числа флагов.

Каждый флаг содержит стабильный `id`, русский текст, измеренное значение,
penalty и provenance входной метрики. Флаг и штраф находятся рядом с
CandidateEvaluation как `riskFlags` и `flagPenalty`; это не четвёртый компонент.

### Обязательная приёмка

#### Запросы, которые пользователь передаёт Codex

1. `POST /evaluation/run` —
   `{"profileId":"deep-value","refresh":true}`.
2. `GET /evaluation/latest?offset=0&limit=200&view=full`.
3. Из ответа выбрать по одному реальному кандидату с `high_turnover`,
   `illiquid` и без известного `turnoverPct`, если такие строки есть.
4. Для каждого выбранного выполнить `GET /evaluation/{token}`.
5. Если в шаге 14.1 был сохранён подтверждённый incentives override, повторить
   run и `GET /evaluation/{token}` для него.

Передать Codex только выбранные карточки и их metrics, `riskFlags`,
`flagPenalty`, `missing`, notes и provenance. Границы ровно 50/0.5 и cap штрафа
20 проверяются unit-тестами Codex; ради них пользователь не подделывает runtime
данные и не создаёт ручные значения без источника.

- [ ] Текст high_turnover/illiquid содержит то же число, что входной metric.
- [ ] Ровно 50 и 0.5 не срабатывают; границы закреплены тестом.
- [ ] Неизвестный turnover не создаёт флаг.
- [ ] Отрицательная экономика после стимулов даёт flag + note.
- [ ] Неизвестные стимулы не становятся нулём.
- [ ] Три сработавших флага всё равно дают penalty 20.
- [ ] Код не ходит в сеть; unit tests, build и full test зелёные.

### Запрещено

Класть флаги в веса, менять score компонента, требовать ручной override,
загружать месячные ряды revenue.

**СТОП.**

---

# ШАГ 15.1 — Ядро ranking, композит и сохранение run

**Зависимости:** 14.2.

**Результат окна:** `RankingService.run()` синхронно создаёт и сохраняет полный
ranking run поверх совместимой evaluation; публичного контроллера пока нет.

### Сделать

1. Ввести разные типы `DataTier` и `RankTier`; мигрировать evaluation с общего
   `Tier`, не меняя значения data tier.
2. `composite()` принимает массив `{ component, score, weight }`, а не три
   именованных аргумента. Это реальный потребитель, не будущая заглушка.
3. Гейт: минимум два известных компонента, `weightSum >= 0.55`; иначе
   `composite:null`, причина, `componentsUsed`, `weightSum`.
4. После гейта нормировать веса доступных компонентов, затем вычесть
   `flagPenalty` и зажать в `0..100` через `money.ts`.
5. Тиры: hard filter → watchlist; composite null или dataQuality ниже
   `minDataQuality` → C; composite ≥ a и dataQuality ≥ 0.7 → A;
   composite ≥ b → B; иначе C.
6. Hard filters только два: `valuation.verdict.passed === false` и
   `tokenomics.verdict.hardFilterFail === true`. Флаг риска не hard filter.
7. Кандидаты не исчезают: watchlist и data gaps сохраняют причины,
   `whatWouldChangeThis`, `notEvaluated` и provenance.
8. Если evaluation отсутствует/несовместима, сервис локально пересчитывает её
   через существующий сервис и помечает `evaluationRecomputed:true`. Профиль
   ranking и evaluation обязан совпасть.
9. Сохранить run по `runId`, `universeVersion`, `builtAt`, `activeFilters`,
   profile, input hashes и formula version. `JobService` не использовать.

### Обязательная приёмка

#### Запросы, которые пользователь передаёт Codex

На этом шаге публичного ranking endpoint ещё нет, поэтому ручных ranking
запросов быть не должно. Для входа внутренней приёмки передать Codex:

1. ответ `POST /evaluation/run` с
   `{"profileId":"deep-value","refresh":true}`;
2. ответ `GET /evaluation/latest?offset=0&limit=3&view=full`;
3. ответ `GET /status` из того же состояния фильтров.

Если `/ranking/run` уже появился в Swagger до шага 15.2, передать этот факт как
нарушение границы шага: контроллер нужно убрать из 15.1, а не принимать раньше.

- [ ] Один компонент → composite null, tier C; не A и не ноль.
- [ ] Два/три компонента дают ожидаемый weighted mean и metadata.
- [ ] Penalty не опускает итог ниже 0.
- [ ] Hard-filter кандидат остаётся в watchlist с причиной.
- [ ] Data gap кандидат остаётся в run.
- [ ] Несовместимая evaluation пересчитана автоматически и это видно.
- [ ] Повтор на том же вводе детерминирован, сеть и JobService не вызваны.
- [ ] `notEvaluated` попадает в ranking card.
- [ ] Unit tests, build и полный test зелёные.

**СТОП.**

---

# ШАГ 15.2 — Публичный ranking API и Swagger

**Зависимости:** 15.1.

**Результат окна:** пользователь получает рейтинг одним `POST`, а затем читает
его страницами.

### HTTP-контракт

- `POST /ranking/run` → `200`, синхронный run;
- `GET /ranking/latest?offset=0&limit=50&view=summary|full` → конверт;
- tag `ranking`, полные DTO и непротиворечивые Swagger examples.

Summary содержит идентичность, группу, data tier, component scores,
dataQuality, composite metadata, rank tier, hard-filter reason и короткие
missing/risk flags. Full дополнительно содержит metrics, percentiles, peers,
provenance, notes, `whatWouldChangeThis`.

Watchlist не прячется и учитывается в totals отдельно. Внутри тира порядок
детерминирован, но API не объявляет его точным инвестиционным рангом.

### Обязательная приёмка

#### Запросы, которые пользователь передаёт Codex

Для каждой из четырёх комбинаций фильтров из шага 12.3 выполнить:

1. соответствующие `POST /universe/screen` и `POST /universe/alpha`;
2. `POST /ranking/run` с `{"profileId":"deep-value"}`;
3. `GET /ranking/latest?offset=0&limit=50&view=summary`.

Для одного состояния дополнительно выполнить:

- `GET /ranking/latest?offset=0&limit=1&view=full`;
- `GET /ranking/latest?offset=0&limit=201&view=summary` — ожидается 4xx;
- `POST /ranking/run` с несуществующим `profileId` — ожидается 4xx.

Передать Codex: HTTP-статусы, `evaluationRecomputed`, context, totals по A/B/C и
watchlist, pagination, один summary item, один full item, размер default ответа
в байтах и оба негативных ответа. Проверить, что POST не возвращает `jobId` и
не меняет `GET /status.job`.

- [ ] POST отвечает 200, не 202, не возвращает jobId и не занимает JobService.
- [ ] Нет evaluation → POST сам создаёт её и сообщает это.
- [ ] Четыре комбинации фильтров работают, ни одна не включается сама.
- [ ] Число ranking candidates равно числу evaluation candidates.
- [ ] Watchlist виден в totals и items; data gaps не исчезают.
- [ ] `limit` default 50, max 200; summary/full различаются ожидаемо.
- [ ] Default response на e2e fixture меньше 300 КБ.
- [ ] Любая 4xx ошибка содержит `code`, `details`, `nextAction`.
- [ ] DTO, Swagger, unit/e2e, build и full test зелёные.

### Запрещено

Требовать alpha, добавлять `/ranking/plan`, возвращать 202, молча менять
профиль, усреднять hard filters, сортировать всё как точный топ.

**СТОП.**

---

# ШАГ 16.1 — Markdown-отчёт и журнал прогонов

**Зависимости:** 15.2.

**Результат окна:** каждый ranking run имеет воспроизводимый markdown и запись
в журнале; GET только читает уже сохранённый файл.

### Сделать

1. При успешном `POST /ranking/run` сохранить отчёт по `runId`, а не по дате.
   Два запуска в день не перезаписывают друг друга.
2. `GET /ranking/report/{runId}` возвращает текст с
   `Content-Type: text/markdown; charset=utf-8`; markdown не заворачивается в
   JSON-строку.
3. Отчёт содержит context, профиль, formula versions, веса, тиры, watchlist,
   карточки, provenance, missing/notEvaluated и дисклеймер.
4. `reports/journal.md` дополняется одной идемпотентной записью на runId: дата,
   universeVersion, activeFilters, evaluation/ranking runId, тиры A/B и
   composite. Повторное чтение/повторная запись не дублирует run.

### Обязательная приёмка

#### Запросы, которые пользователь передаёт Codex

1. Дважды выполнить `POST /ranking/run` с
   `{"profileId":"deep-value"}` и сохранить два разных `runId`.
2. `GET /ranking/report/<RUN_ID_1>` и
   `GET /ranking/report/<RUN_ID_2>` — передать HTTP-статус, заголовок
   `Content-Type` и первые/последние 30 строк каждого markdown.
3. `GET /ranking/report/not-existing-run` — передать статус и тело ошибки.
4. `GET /evaluation/latest?offset=0&limit=1&view=full` и
   `GET /ranking/latest?offset=0&limit=1&view=full` — передать фрагменты с
   дисклеймером.

Полные многостраничные отчёты в сообщение Codex вставлять не нужно. Codex сам
проверяет `reports/journal.md`; пользователь передаёт только два runId, чтобы
проверить отсутствие перезаписи и дублей.

- [ ] Два run в один день имеют разные URL и содержимое не перезаписано.
- [ ] Неизвестный runId → нормализованная 404 с nextAction.
- [ ] Content-Type проверен e2e.
- [ ] Все числа в markdown имеют source/asOf либо явно `unknown`.
- [ ] Journal не дублирует runId.
- [ ] Дисклеймер присутствует дословно во всех evaluation/ranking HTTP-ответах
      и markdown:

> Исследовательский инструмент. Не является инвестиционной рекомендацией.
> Каждое число проверяется по указанному источнику. Механизм возврата ценности
> и условия его отключения не оценивались: они требуют чтения документации
> протокола.

- [ ] Unit/e2e, build и full test зелёные.

**СТОП.**

---

# ШАГ 16.2 — Sensitivity на 25 наборах весов

**Зависимости:** 16.1.

**Результат окна:** `POST /ranking/sensitivity` показывает, насколько итог
зависит от выбранных весов, без сети и без изменения сохранённого ranking.

### Детерминированные сценарии

Множители для tokenomics и valuation:
`[0.70, 0.85, 1.00, 1.15, 1.30] × [0.70, 0.85, 1.00, 1.15, 1.30]`.
Вес sectorPosition имеет множитель `1.00`. После применения множителей три веса
нормируются до суммы `1`. Получается ровно 25 уникальных сценариев, включая
baseline `1.00 × 1.00`.

Для каждого кандидата вернуть baseline, min/max composite, число смен тира и
набор достигнутых тиров. Summary содержит transition matrix и долю кандидатов,
сменивших тир. Интерпретация:

- `stable` — тир изменился не более чем у 10% кандидатов с composite;
- `sensitive` — больше 10%;
- `insufficient_data` — composite есть менее чем у 20 кандидатов.

Порог — именованная константа с тестом, не профиль. Hard filters, dataQuality,
missing components и flag penalties в сценариях не меняются.

### Обязательная приёмка

#### Запросы, которые пользователь передаёт Codex

1. `GET /ranking/latest?offset=0&limit=1&view=summary` — сохранить исходный
   `runId` и baseline кандидата.
2. `POST /ranking/sensitivity` с телом `{"runId":"<RUN_ID>"}`.
3. Повторить тот же sensitivity-запрос второй раз.
4. Снова выполнить `GET /ranking/latest?offset=0&limit=1&view=summary`.
5. `POST /ranking/sensitivity` с
   `{"runId":"not-existing-run"}` — ожидается нормализованная 4xx.

Передать Codex: оба sensitivity-ответа либо их хеши и summary, количество
сценариев, baseline weights, один candidate result, transition matrix,
interpretation, runId ranking до/после и негативный ответ. RunId ranking до и
после должен совпадать.

- [ ] Ровно 25 уникальных нормированных наборов, сумма каждого равна 1.
- [ ] Baseline совпадает с сохранённым ranking в пределах правила округления.
- [ ] Missing score не превращается в ноль ни в одном сценарии.
- [ ] Watchlist не выходит из hard filter из-за смены весов.
- [ ] Endpoint не пишет новый ranking run, не ходит в сеть, не берёт JobService.
- [ ] Результат детерминирован и покрыт unit/e2e.
- [ ] build и полный test зелёные.

**СТОП.**

---

# ШАГ 16.3 — Финальная сквозная приёмка продукта

**Зависимости:** все предыдущие шаги. Нужны runtime-данные и запущенный сервис.

**Результат окна:** `reports/final-acceptance-<date>.md` с PASS/FAIL по каждому
критерию. Это проверка, а не разрешение на широкую переделку.

Если runtime-данных или сервиса нет — `BLOCKED` до правок и один готовый блок
команд для пользователя. Если найден дефект, допускается только маленькая
очевидная правка в границах уже утверждённого контракта. Иначе статус
`FAILED_ACCEPTANCE`, отдельный корректирующий шаг и стоп.

### Основной сценарий

После собранной вселенной путь до рейтинга — не более пяти запросов:

1. `POST /universe/prices`;
2. `POST /universe/tokenomics` при необходимости;
3. ноль, один или два POST для screen/alpha;
4. `POST /ranking/run`.

`POST /evaluation/run` необязателен: ranking умеет пересчитать evaluation сам.
Ручной обход токенов, обязательные overrides и документы не допускаются.

### Обязательная приёмка

#### Запросы, которые пользователь передаёт Codex

Выполнить основной сценарий в Swagger. После любого `202` опрашивать только
`GET /status` до `done` или `failed` и передать конечный status.

1. `GET /status` — исходное состояние.
2. `POST /universe/prices` с пустым телом `{}`.
3. При устаревшей/отсутствующей tokenomics:
   `POST /universe/tokenomics` с `{"force":false}`.
4. Проверить четыре комбинации screen/alpha из шага 12.3; в каждой выполнить
   `POST /ranking/run` с `{"profileId":"deep-value"}`.
5. Для последнего run выполнить:
   `GET /ranking/latest?offset=0&limit=50&view=summary`,
   `GET /ranking/latest?offset=0&limit=1&view=full`,
   `GET /ranking/report/<RUN_ID>` и
   `POST /ranking/sensitivity` с `{"runId":"<RUN_ID>"}`.
6. Выполнить по одному заведомо неверному запросу:
   `GET /ranking/report/not-existing-run` и
   `GET /ranking/latest?limit=201`; передать обе ошибки.
7. Открыть одну ссылку valuation и одну ссылку tokenomics из full/report и
   записать, какое число или событие подтверждено.

Передать Codex один пакет `РУЧНАЯ ПРИЁМКА ШАГА 16.3`: последовательность
метод/путь/статус, конечные status, context каждого run, четыре inputCount,
totals тиров, response sizes, Content-Type отчёта, число sensitivity scenarios,
две ошибки и результаты ручной проверки ссылок. API-ключи, заголовки
авторизации и многомегабайтные полные ответы не передавать.

- [ ] screen on/alpha on → evaluation input равен `status.passed`.
- [ ] Остальные три комбинации фильтров работают и не включаются сами.
- [ ] Три evaluation-компонента создаются одним локальным POST без сети.
- [ ] Повтор не запрашивает источники заново.
- [ ] Смена фильтров пересчитывает comparative-компоненты и reuse tokenomics.
- [ ] Ranking отвечает 200 синхронно, использует ровно evaluation candidates.
- [ ] Без unlocks, revenue или comparison group токен остаётся data gap.
- [ ] Каждый run содержит universeVersion, builtAt, filters, profile, runId и
      formula versions.
- [ ] Открытая ссылка подтверждает минимум одно число valuation и одно событие
      tokenomics; результат записан без длинного копирования источника.
- [ ] Любая проверенная 4xx имеет `code`, `message`, `details`, `nextAction`.
- [ ] Default ответы списков меньше 300 КБ по `curl -w '%{size_download}'`.
- [ ] Markdown читается как text/markdown; sensitivity содержит 25 сценариев.
- [ ] Swagger на `/api` позволяет пройти сценарий без знания внутренних файлов.
- [ ] `git diff --check`, build, полный unit и e2e зелёные.

**СТОП. ПРОДУКТ ГОТОВ только при PASS всех пунктов.**

---

## Отложено до появления модели

Не создавать пустые интерфейсы и модули. Возврат LLM начинается отдельным
утверждённым эпиком только после появления:

- автоматического сбора официальной документации с измеренным покрытием;
- версионированного корпуса реальных кейсов;
- human-reviewed эталона и benchmark на одинаковых входах;
- маршрутизации cheap/quality с fallback без потери качества;
- отдельной приёмки `mechanism` и `critic`.

Единственная подготовка в текущем коде: `composite()` принимает массив
компонентов с весами. Никаких `LlmPort`, provider SDK и cache namespace заранее.

---

## Открытый долг

Не входит ни в один шаг автоматически:

- ниши с ровно тремя сравнимыми участниками имеют нулевой запас;
- потолок бесплатного покрытия revenue — около 47 сравнимых;
- без месячного ряда нет устойчивости revenue и обнаружения разового всплеска;
- revenue/fees и pRev/pFees коррелируют — sensitivity не заменяет проверку
  двойного веса;
- признак сети не всегда выводится из категории;
- подсети Bittensor требуют отдельной группы или исключения;
- data tier `yield` пока не имеет порога значимости;
- выручка приватных биржевых токенов не проверяется открытым источником;
- `realizedEmission` возможен только со второго снимка;
- аутентификация и многопользовательский `ActiveFilterState` отложены до сайта.

Любой пункт долга сначала получает отдельный номер, контракт и приёмку. Затем
его можно передавать Codex как одно новое окно.
