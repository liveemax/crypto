import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  UniverseCompareResponseDto,
  RefreshUniverseDto,
  RefreshUniverseResponseDto,
  UniverseQueryDto,
  ScreenApplyResponseDto,
  UniverseStatusDto,
  FunnelViewDto,
} from './universe.dto';
import { UniverseListResponseDto } from './list.dto';
import type { UniverseSummaryRow } from './summary';
import { DataGapListResponseDto, DataGapQueryDto } from './data-gaps.dto';
import { ScreenSelectionDto } from './filter-state.dto';
import { AlphaSelectionDto } from './alpha.dto';
import { CoverageReportDto } from './coverage.dto';
import { AlphaApplyResponseDto } from './universe.dto';
import { CompareUniverseDto } from './profile.dto';
import { UniverseService } from './universe.service';
import { ProfileReference, UniverseListQuery } from './universe.types';
import type { CandidateView } from './universe.types';
import type { DataGapRow } from './data-gaps.types';
import type { Envelope } from '../envelope.types';
import type { AlphaSelectionRequest, ScreenSelectionRequest } from './filter-state.types';

@ApiTags('universe')
@Controller('universe')
export class UniverseController {
  constructor(private readonly universe: UniverseService) {}

  @Post('refresh')
  @ApiOperation({
    summary: 'ШАГ 1. Скачать состав вселенной. Раз в месяц, ~25 запросов',
    description:
      'Определяет, кто вообще во вселенной: топ-1300 CoinGecko, склейка с протоколами ' +
      'и сетями DeFiLlama. Единственный эндпоинт, который тянет состав из интернета.\n\n' +
      'Идёт в фоне 3–5 минут, ответ приходит сразу. Ход — в GET /status: ' +
      'ждите state=done.\n\n' +
      'Без force пересборка запускается, только если состав старше месяца. ' +
      'Обновить цены по тому же составу дешевле — POST /universe/prices.',
  })
  @ApiBody({ type: RefreshUniverseDto, required: false })
  @ApiOkResponse({ type: RefreshUniverseResponseDto })
  async refresh(
    @Query() query: RefreshUniverseDto,
    @Body() body: RefreshUniverseDto = {},
  ): Promise<RefreshUniverseResponseDto> {
    return this.universe.ensureFresh({
      force: query.force ?? body.force,
      topN: query.topN ?? body.topN,
    });
  }

  @Post('prices')
  @ApiOperation({
    summary: 'ШАГ 2. Обновить цены и выручку по тому же составу',
    description:
      'Тянет свежий рынок CoinGecko и три сводки комиссий DeFiLlama по уже собранным ' +
      'монетам. Кто во вселенной, version и builtAt не меняются — меняются только числа.\n\n' +
      'Около 9 запросов и до минуты, поэтому работает в фоне: ответ приходит сразу, ' +
      'ход — в GET /status, результат — в POST /universe/screen.\n\n' +
      'Нужен, если состав собран вчера или раньше, а смотреть хочется на сегодняшние цены.',
  })
  @ApiOkResponse({ type: RefreshUniverseResponseDto })
  async prices(): Promise<RefreshUniverseResponseDto> {
    return this.universe.refreshPrices();
  }

  @Post('screen')
  @ApiOperation({
    summary: 'ШАГ 3. Фильтр шлака: включить или выключить',
    description:
      'Обратимый фильтр поверх неизменной вселенной. В сеть не ходит, снимок не ' +
      'меняет, работает мгновенно — включайте и выключайте сколько угодно раз.\n\n' +
      'enabled: true включает фильтр, enabled: false выключает и возвращает ровно тот ' +
      'состав, что был без него. Конфигурация при выключении не стирается: включить ' +
      'обратно тем же профилем можно телом {"enabled": true}.\n\n' +
      'При включении передавайте ЛИБО profileId готового профиля, ЛИБО полный profile ' +
      'для разового эксперимента. Оба сразу — ошибка, профиль при enabled: false — тоже.\n\n' +
      'После вызова GET /status, GET /universe/funnel и GET /universe показывают ' +
      'результат всех включённых фильтров. Отдельного «разового взгляда» больше нет: ' +
      'два ответа с разными числами по одному снимку — это баг, а не фича. ' +
      'Сравнить два профиля, не трогая рабочее состояние, — POST /universe/compare.\n\n' +
      'Готовые профили и их гипотезы — в GET /config/profiles.',
  })
  @ApiBody({
    type: ScreenSelectionDto,
    required: true,
    examples: {
      deepValue: {
        summary: 'Включить deep-value — плачу за дешевизну к выручке',
        value: { enabled: true, profileId: 'deep-value' },
      },
      yieldHunter: {
        summary: 'Включить yield-hunter — плачу за доходность держателя',
        value: { enabled: true, profileId: 'yield-hunter' },
      },
      again: {
        summary: 'Включить обратно с прежней конфигурацией',
        value: { enabled: true },
      },
      off: {
        summary: 'Выключить: вернуться к вселенной без фильтра шлака',
        value: { enabled: false },
      },
    },
  })
  @ApiOkResponse({ type: ScreenApplyResponseDto })
  async screen(@Body() body: ScreenSelectionDto): Promise<ScreenApplyResponseDto> {
    return this.universe.applyScreen(body as unknown as ScreenSelectionRequest);
  }

  @Post('alpha')
  @ApiOperation({
    summary: 'ШАГ 4. Лидеры ниш: включить или выключить',
    description:
      'Второй обратимый фильтр. Режет ТОЛЬКО перенасыщенные секторы: если ' +
      'участников больше perSector, остаётся top-N по перцентилям внутри сектора. ' +
      'Сектор меньше или равный perSector остаётся целиком — единственный участник ' +
      'ниши это свойство рынка, а не приговор токену.\n\n' +
      'Абсолютных порогов здесь нет намеренно. «Выручка не ниже миллиона» — это ' +
      'screen; альфа отвечает на один вопрос: кто в топе своей ниши.\n\n' +
      'Применяется поверх screen, а если screen выключен — поверх всего снимка. ' +
      'Порядок вызовов не важен: считается всегда snapshot → screen → alpha.\n\n' +
      'Читайте decision у каждого отсеянного и sectors в ответе. Отсев по ' +
      'конкуренции (alpha_outranked) и отсев по дырам в данных (alpha_unrankable, ' +
      'alpha_missing_sector) — разные вещи: второе едет в GET /universe/data-gaps и ' +
      'означает, что система про токен ничего не знает, а не что он хуже конкурентов.\n\n' +
      'enabled: false немедленно возвращает всех отсеянных альфой; screen при этом ' +
      'не выключается. В сеть не ходит, снимок не меняет.',
  })
  @ApiBody({
    type: AlphaSelectionDto,
    required: true,
    examples: {
      on: {
        summary: 'Включить с конфигурацией профиля default',
        value: { enabled: true, profileId: 'default' },
      },
      narrow: {
        summary: 'Разовая конфигурация: по три на нишу',
        value: {
          enabled: true,
          alpha: {
            perSector: 3,
            minRankedValues: 3,
            minScoreMetrics: 2,
            rankBy: [
              { field: 'holderYieldPct', direction: 'higher_better' },
              { field: 'revenue12mUsd', direction: 'higher_better' },
              { field: 'revenuePerTvlPct', direction: 'higher_better' },
              { field: 'pRev', direction: 'lower_better' },
            ],
          },
        },
      },
      off: { summary: 'Выключить и вернуть отсеянных', value: { enabled: false } },
    },
  })
  @ApiOkResponse({ type: AlphaApplyResponseDto })
  async alpha(@Body() body: AlphaSelectionDto): Promise<AlphaApplyResponseDto> {
    return this.universe.applyAlphaFilter(body as unknown as AlphaSelectionRequest);
  }

  @Post('compare')
  @ApiOperation({
    summary: 'Сравнить два профиля на одной вселенной',
    description:
      'Показывает, кто прошёл в обоих отборах, кто только в левом, кто только в правом ' +
      'и у кого сменился тир. Нужен, чтобы увидеть, чем результат обязан данным, ' +
      'а чем — вашему мнению: если два разумных профиля дают полностью разный состав, ' +
      'вы смотрите на свои настройки, а не на рынок.\n\n' +
      'В поля left и right кладите строку с именем профиля: "default", "yield-hunter", ' +
      '"deep-value". В сеть не ходит.',
  })
  @ApiOkResponse({ type: UniverseCompareResponseDto })
  async compare(@Body() body: CompareUniverseDto): Promise<UniverseCompareResponseDto> {
    return this.universe.compare(
      body.left as unknown as ProfileReference,
      body.right as unknown as ProfileReference,
    );
  }

  @Get('status')
  @ApiOperation({
    deprecated: true,
    summary: 'Устаревший алиас раздела: используйте GET /status',
    description:
      'Оставлен, чтобы не ломать существующие ссылки, и не расширяется. Единственный ' +
      'источник прогресса — GET /status: он показывает задачу любого типа, свежесть ' +
      'каждого слоя данных, активную выборку и следующее действие.',
  })
  @ApiOkResponse({ type: UniverseStatusDto })
  async status(): Promise<UniverseStatusDto> {
    return this.universe.status();
  }

  @Get('coverage')
  @ApiOperation({
    summary: 'Насколько система вообще способна сравнивать',
    description:
      'Доля участников без группы сравнения — по числу монет И по капитализации. ' +
      'Оба порога обязательны: десять процентов монет бывают половиной денег.\n\n' +
      'Считается на ВХОДЕ альфы, при выключенной альфе. Иначе фильтр улучшал бы ' +
      'собственную метрику, удаляя тех, кого не покрыли.\n\n' +
      'revenue.byState разделяет пробелы по типу: known_zero — ноль измерен и ' +
      'подтверждён, это не пробел; mapping_failed — монета не склеена с протоколом; ' +
      'unsupported_business_model — сеть платит валидаторам, а не держателю, ей ' +
      'нужны свои метрики. Разные состояния чинятся по-разному.\n\n' +
      'Поимённая очередь этих пробелов — в GET /universe/data-gaps. В сеть не ходит.',
  })
  @ApiOkResponse({ type: CoverageReportDto })
  async coverage(): Promise<CoverageReportDto> {
    return this.universe.coverage();
  }

  @Get('funnel')
  @ApiOperation({
    summary: 'Воронка включённых фильтров: где именно отсеялись монеты',
    description:
      'На каждой проверке: сколько вошло, сколько отсеяно, сколько осталось, и какой ' +
      'фильтр её выполнял. Проверки идут по очереди, поэтому отсеянный на третьей до ' +
      'четвёртой не доходит — число напротив проверки зависит от того, кто стоял раньше.\n\n' +
      'Ни один фильтр не включён — стадий нет, и это не ошибка: отсева не было.\n\n' +
      'universeVersion, builtAt и activeFilters отвечают на вопрос «откуда эти числа»: ' +
      'воронка это мнение конкретной композиции фильтров о конкретном снимке.',
  })
  @ApiOkResponse({ type: FunnelViewDto })
  async funnel(): Promise<FunnelViewDto> {
    const view = await this.universe.view();
    return {
      universeVersion: view.universeVersion,
      builtAt: view.builtAt,
      activeFilters: view.activeFilters,
      ...view.funnel,
    };
  }

  @Get('data-gaps')
  @ApiOperation({
    summary: 'Очередь пробелов: что мешает посчитать числа и по каким токенам',
    description:
      'Полный список строк, у которых не хватает данных, отсортированный по ' +
      'капитализации: чинить нужно те, за которыми стоят деньги, а не те, что первыми ' +
      'по алфавиту.\n\n' +
      'known_zero сюда не попадает: подтверждённый ноль — измерение, а не задача. ' +
      'У каждого пробела назван тип (mapping_failed, source_missing, source_error, ' +
      'matched_unparsed, source_stale, unsupported_business_model) и то, чем он ' +
      'закрывается: это очередь задач для адаптеров, а не рабочее место оператора.\n\n' +
      'pagination.total всегда полный, даже когда страница короче: обрезанная очередь ' +
      'выглядит короткой и создаёт ложное впечатление порядка.',
  })
  @ApiOkResponse({ type: DataGapListResponseDto })
  async dataGaps(@Query() query: DataGapQueryDto): Promise<Envelope<DataGapRow>> {
    return this.universe.dataGaps(query);
  }

  @Get()
  @ApiOperation({
    summary: 'Список монет с числами, тирами и причинами отсева',
    description:
      'Каждая строка — посчитанные кодом числа со ссылкой на источник и временем ' +
      'обновления источника. По умолчанию только прошедшие рабочий отбор; ' +
      'passedOnly=false покажет и отсеянных с полем rejectReason — почему именно.\n\n' +
      'context рядом со списком обязателен: без universeVersion, builtAt и ' +
      'activeFilters «331» не отличить ни от другого отбора, ни от другого снимка.\n\n' +
      'Отдаётся страницами: limit по умолчанию 50, максимум 200. По умолчанию ' +
      'view=summary — перцентили ниши, peers, склейка и сырые категории в него не ' +
      'входят: на пятидесяти строках это половина веса ответа. Разбирать один токен ' +
      'дешевле через GET /universe/{token}, там всё это есть вместе с оценкой.',
  })
  @ApiOkResponse({ type: UniverseListResponseDto })
  async list(
    @Query() query: UniverseQueryDto,
  ): Promise<Envelope<CandidateView | UniverseSummaryRow>> {
    return this.universe.list(query as UniverseListQuery);
  }
}