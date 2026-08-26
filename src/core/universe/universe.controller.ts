import { Body, Controller, Get, NotFoundException, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  UniverseCompareResponseDto,
  FunnelReportDto,
  RefreshUniverseDto,
  RefreshUniverseResponseDto,
  UniverseCandidateDto,
  UniverseQueryDto,
  ScreenApplyResponseDto,
  UniverseStatusDto,
  FunnelViewDto,
} from './universe.dto';
import { ScreenSelectionDto } from './filter-state.dto';
import { AlphaSelectionDto } from './alpha.dto';
import { CoverageReportDto } from './coverage.dto';
import { AlphaApplyResponseDto } from './universe.dto';
import { CompareUniverseDto } from './profile.dto';
import { UniverseService } from './universe.service';
import { ProfileReference, UniverseCandidate } from './universe.types';
import type { AlphaSelectionRequest, ScreenSelectionRequest } from './filter-state.types';

type SortKey = 'rank' | 'holderYieldPct' | 'revenue12mUsd' | 'pRev';

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
      'Идёт в фоне 3–5 минут, ответ приходит сразу. Ход — в GET /universe/status: ' +
      'ждите state=idle и step=done.\n\n' +
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
      'ход — в GET /universe/status, результат — в POST /universe/screen.\n\n' +
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
      'После вызова GET /universe/status, GET /universe/funnel и GET /universe ' +
      'показывают результат всех включённых фильтров. Отдельного «разового взгляда» ' +
      'больше нет: два ответа с разными числами по одному снимку — это баг, а не фича. ' +
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
      'alpha_missing_sector) — разные вещи: второе едет в dataGaps и означает, что ' +
      'система про токен ничего не знает, а не что он хуже конкурентов.\n\n' +
      'enabled: false немедленно возвращает всех отсеянных альфой; screen при этом ' +
      'не выключается. В сеть не ходит, снимок не меняет.',
  })
  @ApiBody({
    type: AlphaSelectionDto,
    required: true,
    examples: {
      on: { summary: 'Включить с конфигурацией профиля default', value: { enabled: true, profileId: 'default' } },
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
  async compare(
    @Body() body: CompareUniverseDto,
  ): Promise<UniverseCompareResponseDto> {
    return this.universe.compare(
      body.left as unknown as ProfileReference,
      body.right as unknown as ProfileReference,
    );
  }

  @Get('status')
  @ApiOperation({
    summary: 'Что сейчас происходит и что осталось после всех фильтров',
    description:
      'state: idle — работы нет, running — идёт сборка или обновление чисел, ' +
      'error — упало, причина в поле error. Проценты и остаток времени — в progress.\n\n' +
      'passed и tiers считаются композицией включённых фильтров, она целиком в ' +
      'activeFilters. Ни один не включён — passed равно total.\n\n' +
      'activeFilters переживает перезапуск сервиса: состояние лежит в data/, а не ' +
      'в памяти процесса.',
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
      'В сеть не ходит. Порог двигается только вниз.',
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

  @Get()
  @ApiOperation({
    summary: 'Список монет с числами, тирами и причинами отсева',
    description:
      'Каждая строка — посчитанные кодом числа со ссылкой на источник и временем ' +
      'обновления источника. По умолчанию только прошедшие рабочий отбор; ' +
      'passedOnly=false покажет и отсеянных с полем rejectReason — почему именно.\n\n' +    
      'Тиры и причины считаются композицией включённых фильтров, её состав — ' +
      'в GET /universe/status.\n\n' +
      'Отдаётся страницами: limit по умолчанию 100, максимум 2000. Полный список — ' +
      'это мегабайты JSON, на которых виснет страница Swagger.',
  })
  @ApiOkResponse({ type: UniverseCandidateDto, isArray: true })
  async list(@Query() query: UniverseQueryDto): Promise<UniverseCandidateDto[]> {
    const snapshot = await this.universe.latest();
    if (!snapshot) {
      throw new NotFoundException(
        'Вселенная ещё не собрана. Вызовите POST /universe/refresh',
      );
    }
    const passedOnly = query.passedOnly ?? true;
    const sector = query.sector?.trim().toLowerCase();
    const sort = (query.sort ?? 'rank') as SortKey;    
    const view = await this.universe.view();

    return view.candidates
      .filter((item) => (passedOnly ? item.passed : true))
      .filter((item) => (query.tier ? item.tier === query.tier : true))
      .filter((item) => (sector ? item.sector === sector : true))
      .sort(comparator(sort))
      .slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 100));
  }
}

/** rank сортируется по возрастанию, финансовые метрики — по убыванию. */
function comparator(
  sort: SortKey,
): (left: UniverseCandidate, right: UniverseCandidate) => number {
  if (sort === 'rank') return (left, right) => left.rank - right.rank;
  if (sort === 'pRev') {
    return (left, right) => (left.pRev ?? Infinity) - (right.pRev ?? Infinity);
  }
  return (left, right) => (right[sort] ?? -Infinity) - (left[sort] ?? -Infinity);
}
