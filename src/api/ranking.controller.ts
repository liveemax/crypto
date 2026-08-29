import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RankingService } from '../core/ranking/ranking.service';
import type { RankingListResponse, RankingRunResponse } from '../core/ranking/ranking.types';
import { RankingListResponseDto, RankingQueryDto, RankingRunDto, RankingRunResponseDto } from './dto/ranking.dto';

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
}
