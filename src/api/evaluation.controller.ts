import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { EvaluationService } from '../core/evaluation/evaluation.service';
import type {
  EvaluationListResponse,
  EvaluationRunResponse,
  EvaluationTokenResponse,
} from '../core/evaluation/evaluation.types';
import {
  EvaluationListResponseDto,
  EvaluationQueryDto,
  EvaluationRunDto,
  EvaluationRunResponseDto,
  EvaluationTokenResponseDto,
} from './dto/evaluation.dto';

@ApiTags('evaluation')
@Controller('evaluation')
export class EvaluationController {
  constructor(private readonly evaluation: EvaluationService) {}

  @Post('run')
  @HttpCode(200)
  @ApiSecurity('admin-key')
  @ApiOperation({
    summary: 'ШАГ 5. Оценить всю текущую выборку одним вызовом',
    description:
      'Считает valuation, tokenomics и sectorPosition сразу по всем, кто прошёл ' +
      'включённые фильтры. Списка тикеров в запросе нет: вход — то же самое, что ' +
      'показывает GET /universe.\n\n' +
      'В сеть не ходит и слот фоновой задачи не занимает, поэтому отвечает 200 ' +
      'сразу. Фильтры сам не включает и состав выборки не меняет.\n\n' +
      'Работает при любой комбинации фильтров, включая оба выключенных — тогда ' +
      'оценивается вся вселенная.\n\n' +
      'Совместимость считается покомпонентно: сменили screen или alpha — ' +
      'tokenomics прежних токенов переиспользуется, а сравнительные valuation и ' +
      'sectorPosition пересчитываются. ' +
      'Что именно переиспользовано, видно в reuse.',
  })
  @ApiBody({ type: EvaluationRunDto, required: false })
  @ApiOkResponse({ type: EvaluationRunResponseDto })
  async run(
    @Query() query: EvaluationRunDto,
    @Body() body: EvaluationRunDto = {},
  ): Promise<EvaluationRunResponse> {
    return this.evaluation.run({
      profileId: query.profileId ?? body.profileId,
      refresh: query.refresh ?? body.refresh,
    });
  }

  @Get('latest')
  @ApiOperation({
    summary: 'Последний прогон оценки страницами',
    description:
      'Читает сохранённый прогон, ничего не пересчитывая. context рядом с числами ' +
      'обязателен: без universeVersion и activeFilters «331» не отличить ни от ' +
      'другого отбора, ни от другого снимка.\n\n' +
      'view=summary по умолчанию: полные блоки с метриками — это мегабайты JSON.',
  })
  @ApiOkResponse({ type: EvaluationListResponseDto })
  async latest(@Query() query: EvaluationQueryDto): Promise<EvaluationListResponse> {
    return this.evaluation.list(query);
  }

  @Get(':token')
  @ApiOperation({
    summary: 'Три компонента одного токена',
    description:
      'Токена в прогоне не было — 200 со status: not_in_selection и причиной, ' +
      'а не 404: сценарий начинается с ввода тикера, и 404 здесь худший ответ.',
  })
  @ApiParam({ name: 'token', example: 'AAVE', description: 'Тикер или coingeckoId' })
  @ApiOkResponse({ type: EvaluationTokenResponseDto })
  async token(@Param('token') token: string): Promise<EvaluationTokenResponse> {
    return this.evaluation.token(token);
  }
}
