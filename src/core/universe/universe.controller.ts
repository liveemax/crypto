import { Body, Controller, Get, NotFoundException, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  UniverseCompareResponseDto,
  FunnelReportDto,
  RefreshUniverseDto,
  RefreshUniverseResponseDto,
  UniverseCandidateDto,
  UniverseQueryDto,
  UniverseScreenResponseDto,
  UniverseStatusDto,
  FunnelViewDto,
} from './universe.dto';
import { UniverseAlphaResponseDto } from './alpha.dto';
import { CompareUniverseDto, ProfileSelectionDto } from './profile.dto';
import { UniverseService } from './universe.service';
import { ProfileReference, ProfileSelection, UniverseCandidate } from './universe.types';

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
    summary: 'ШАГ 3. Отобрать интересное — мгновенно, без интернета',
    description:
      'Прогоняет уже собранную вселенную через фильтры выбранного профиля и отдаёт ' +
      'воронку отсева и тиры. В сеть не ходит, снимок не меняет, работает мгновенно — ' +
      'меняйте профиль сколько угодно раз, это бесплатно.\n\n' +
      'ВЫБРАННЫЙ ОТБОР СТАНОВИТСЯ РАБОЧИМ. После этого GET /universe/status, ' +
      'GET /universe/funnel и GET /universe показывают его, а не базовый. ' +
      'Разово посмотреть другой, не меняя рабочий, — параметр profileId в этих трёх.\n\n' +
      'Передавайте ЛИБО profileId готового профиля, ЛИБО полный profile для разового ' +
      'эксперимента. Оба сразу — ошибка. Пустое тело равно profileId=default.\n\n' +
      'Готовые профили и их гипотезы — в GET /config/profiles.\n\n' +
      'Читать в ответе надо tiers, а не passed: yield — выручка доходит до держателя, ' +
      'economics — выручка есть, до держателя не доходит, pool — данных нет, ' +
      'rejected — отсеян шлак-фильтром.',
  })
  @ApiBody({
    type: ProfileSelectionDto,
    required: false,
    examples: {
      default: {
        summary: 'default — базовый шлак-фильтр, то же что при сборке',
        value: { profileId: 'default' },
      },
      yieldHunter: {
        summary: 'yield-hunter — плачу за доходность держателя',
        value: { profileId: 'yield-hunter' },
      },
      deepValue: {
        summary: 'deep-value — плачу за дешевизну к выручке',
        value: { profileId: 'deep-value' },
      },
    },
  })
  @ApiQuery({
    name: 'includeCandidates',
    required: false,
    type: Boolean,
    description:
      'Вернуть сами монеты. По умолчанию false: 1300 строк — это мегабайты JSON, ' +
      'на которых виснет страница Swagger, а не сервер. Смотрите funnel и tiers, ' +
      'полный список — в GET /universe',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Сколько монет вернуть при includeCandidates=true. По умолчанию 50, максимум 500',
  })
  @ApiOkResponse({ type: UniverseScreenResponseDto })
  async screen(
    @Body() body: ProfileSelectionDto = {},
    @Query('includeCandidates') includeCandidates?: string,
    @Query('limit') limit?: string,
  ): Promise<UniverseScreenResponseDto> {
    const result = await this.universe.screen(body as unknown as ProfileSelection);
    // Выбранный отбор становится рабочим: GET /universe/status, /universe/funnel
    // и /universe начинают показывать его, а не базовый.
    this.universe.setActive(result.profile);
    if (includeCandidates !== 'true') return { ...result, candidates: [] };
    const size = Number(limit);
    const take = Number.isFinite(size) && size > 0 ? Math.min(size, 500) : 50;
    return { ...result, candidates: result.candidates.slice(0, take) };
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
    summary: 'Что сейчас происходит и сколько прошло рабочий отбор',
    description:
      'state: idle — работы нет, running — идёт сборка или обновление чисел, ' +
      'error — упало, причина в поле error. Проценты и остаток времени — в progress.\n\n' +
      'passed и tiers считаются рабочим отбором, его имя — в profileId. ' +
      'Рабочий отбор задаётся последним POST /universe/screen.',
  })
  @ApiOkResponse({ type: UniverseStatusDto })
  async status(): Promise<UniverseStatusDto> {
    const base = await this.universe.status();
    const active = await this.universe.activeSummary();
    return active ? { ...base, ...active } : { ...base, profileId: null };
  }

  @Get('funnel')
  @ApiOperation({
    summary: 'Воронка рабочего отбора: где именно отсеялись монеты',
    description:
      'На каждой проверке: сколько вошло, сколько отсеяно, сколько осталось. ' +
      'Проверки идут по очереди, поэтому отсеянный на третьей до четвёртой не доходит — ' +
      'число напротив проверки зависит от того, кто стоял раньше.\n\n' +
      'Считается рабочим отбором, который задал последний POST /universe/screen. ' +
      'Разово посмотреть другой — параметр profileId; рабочий при этом не меняется.\n\n' +
      'universeVersion, builtAt и profileId в ответе отвечают на вопрос «откуда эти ' +
      'числа»: воронка это мнение конкретного отбора о конкретном снимке.',
  })
  @ApiQuery({ name: 'profileId', required: false, type: String })
  @ApiOkResponse({ type: FunnelViewDto })
  async funnel(@Query('profileId') profileId?: string): Promise<FunnelViewDto> {
    const snapshot = await this.universe.latest();
    if (!snapshot) {
      throw new NotFoundException(
        'Вселенная ещё не собрана. Вызовите POST /universe/refresh',
      );
    }
    const view = await this.universe.view(profileId);
    return {
      universeVersion: view.universeVersion,
      builtAt: view.builtAt,
      profileId: view.profile.id,
      ...view.funnel,
    };
  }

  @Get('alpha')
  @ApiOperation({
    summary: 'ШАГ 4. Лидеры секторов — мгновенно, без интернета',
    description:
      'Сравнивает каждый проект с прямыми конкурентами, а не со всем рынком: внутри ' +
      'сектора считаются перцентили по метрикам профиля, среднее даёт sectorScore.\n\n' +
      'Лидер — тот, кто СНАЧАЛА прошёл абсолютный порог alpha.qualify и ТОЛЬКО ПОТОМ ' +
      'попал в топ alpha.perSector. Топ-5 не добивается ради числа: лидер сектора ' +
      'из двух убыточных — не вывод.\n\n' +
      'Три списка, а не один. leaders — альфа. sectorsWithoutComparison — секторы, ' +
      'где сравнивать не с кем: там честно нет лидера, а не назначен единственный ' +
      'участник. needsManualData — крупные и ликвидные токены без финансовых данных: ' +
      'это рабочая очередь на ручной сбор, а не отбросы.\n\n' +
      'В сеть не ходит, снимок не меняет. Без profileId считает рабочим отбором, ' +
      'который задал последний POST /universe/screen — так меняются perSector и ' +
      'minSectorSize без пересборки вселенной.',
  })
  @ApiQuery({
    name: 'profileId',
    required: false,
    type: String,
    description: 'Разово посмотреть другим отбором. Рабочий отбор при этом не меняется',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description:
      'Сколько строк вернуть в needsManualData. По умолчанию 50, максимум 500. ' +
      'Полное число — в totals.needsManualData',
  })
  @ApiOkResponse({ type: UniverseAlphaResponseDto })
  async alpha(
    @Query('profileId') profileId?: string,
    @Query('limit') limit?: string,
  ): Promise<UniverseAlphaResponseDto> {
    const report = await this.universe.alpha(profileId);
    const size = Number(limit);
    const take = Number.isFinite(size) && size > 0 ? Math.min(size, 500) : 50;
    return { ...report, needsManualData: report.needsManualData.slice(0, take) };
  }

  @Get()
  @ApiOperation({
    summary: 'Список монет с числами, тирами и причинами отсева',
    description:
      'Каждая строка — посчитанные кодом числа со ссылкой на источник и временем ' +
      'обновления источника. По умолчанию только прошедшие рабочий отбор; ' +
      'passedOnly=false покажет и отсеянных с полем rejectReason — почему именно.\n\n' +
      'Тиры и причины считаются рабочим отбором. Разово другой — параметр profileId.\n\n' +
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
    const view = await this.universe.view(query.profileId);

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
