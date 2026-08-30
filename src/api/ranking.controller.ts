import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import { RankingService } from '../core/ranking/ranking.service';
import type { SensitivityResult } from '../core/ranking/sensitivity.types';
import type { RankingListResponse, RankingRunResponse } from '../core/ranking/ranking.types';
import {
  RankingListResponseDto,
  RankingQueryDto,
  RankingRunDto,
  RankingRunResponseDto,
  SensitivityResponseDto,
  SensitivityRunDto,
} from './dto/ranking.dto';

/**
 * Только заголовок, который нужен отчёту. Не express.Response: типов express
 * в проекте нет, а полный Response здесь не нужен — только успешный путь ставит
 * Content-Type, ошибка идёт через ApiExceptionFilter и обычный application/json.
 */
interface HeaderResponse {
  header(name: string, value: string): unknown;
}

@ApiTags('ranking')
@Controller('ranking')
export class RankingController {
  constructor(private readonly ranking: RankingService) {}

  @Post('run')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Построить и сохранить рейтинг одним вызовом',
    description:
      'Локальный синхронный расчёт поверх совместимой evaluation: сети нет, слот ' +
      'JobService не занимается, поэтому ответ — сразу 200, а не 202.\n\n' +
      'Совместимой evaluation нет или профиль не совпал — сервис пересчитывает её ' +
      'сам через тот же локальный путь; evaluationRecomputed в ответе показывает, ' +
      'что это произошло. Фильтры screen/alpha этот вызов не включает: он берёт ' +
      'ровно те кандидаты, что видит evaluation по текущей активной выборке.\n\n' +
      'Watchlist (хард-фильтр valuation или подтверждённый отрицательный NHY) ' +
      'остаётся в ответе и в totals, а не исчезает из списка.',
  })
  @ApiBody({ type: RankingRunDto, required: false })
  @ApiOkResponse({ type: RankingRunResponseDto })
  async run(@Body() body: RankingRunDto = {}): Promise<RankingRunResponse> {
    return this.ranking.runPaged({ profileId: body.profileId });
  }

  @Get('latest')
  @ApiOperation({
    summary: 'Последний сохранённый рейтинг страницами',
    description:
      'Читает сохранённый ranking run, ничего не пересчитывая. context называет ' +
      'universeVersion, activeFilters и профиль этого прогона: число тиров без них ' +
      'не отличить ни от другого отбора, ни от другого снимка.\n\n' +
      'view=summary по умолчанию: баллы, тир и короткие риск-флаги. view=full ' +
      'добавляет полную evaluation-карточку каждого кандидата — metrics, ' +
      'percentiles, peers и provenance, это уже мегабайты JSON.',
  })
  @ApiOkResponse({ type: RankingListResponseDto })
  async latest(@Query() query: RankingQueryDto): Promise<RankingListResponse> {
    return this.ranking.list(query);
  }

  @Post('sensitivity')
  @HttpCode(200)
  @ApiOperation({
    summary: 'ШАГ 16.2. Насколько итог зависит от весов профиля',
    description:
      'Прогоняет кандидатов уже сохранённого ranking run через 25 детерминированных ' +
      'весовых сценариев (сетка множителей tokenomics×valuation 5×5, sectorPosition ' +
      'всегда ×1.00, после множителя веса нормируются до суммы 1).\n\n' +
      'Ничего не пересчитывает и не сохраняет: ни evaluation, ни новый ranking run, ' +
      'сети и JobService тоже нет — только чтение сохранённого run по runId и чистый ' +
      'расчёт. Hard filters, dataQuality, missing components и flagPenalty в сценариях ' +
      'не меняются: изолируется именно эффект весов.\n\n' +
      'summary.interpretation: stable — тир сменился не более чем у 10% кандидатов с ' +
      'composite; sensitive — больше 10%; insufficient_data — таких кандидатов меньше 20.',
  })
  @ApiBody({ type: SensitivityRunDto })
  @ApiOkResponse({ type: SensitivityResponseDto })
  async sensitivity(@Body() body: SensitivityRunDto): Promise<SensitivityResult> {
    return this.ranking.sensitivity({ runId: body.runId, offset: body.offset, limit: body.limit });
  }

  @Get('report/:runId')
  @ApiProduces('text/markdown')
  @ApiOperation({
    summary: 'Markdown-отчёт сохранённого ranking run по его runId',
    description:
      'Читает уже сохранённый при POST /ranking/run отчёт, ничего не пересчитывая. ' +
      'Отчёт сохранён по runId, а не по дате: два прогона за день не перезаписывают ' +
      'друг друга. Неизвестный runId — нормализованная 404, а не пустой текст.',
  })
  @ApiParam({ name: 'runId', example: 'rank_2026-08-28T09-12-00-000Z_deep-value' })
  @ApiOkResponse({ description: 'Markdown-текст отчёта', schema: { type: 'string' } })
  async report(
    @Param('runId') runId: string,
    @Res({ passthrough: true }) res: HeaderResponse,
  ): Promise<string> {
    const text = await this.ranking.report(runId);
    // Заголовок ставится только на успешном пути: ошибка идёт через
    // ApiExceptionFilter, и её JSON не должен унаследовать text/markdown.
    res.header('Content-Type', 'text/markdown; charset=utf-8');
    return text;
  }
}
