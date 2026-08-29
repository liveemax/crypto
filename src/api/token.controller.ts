import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TokenService } from '../core/system/token.service';
import type { TokenReport } from '../core/system/token.types';
import { ApiErrorDto } from '../core/envelope.dto';
import { TokenReportDto } from './dto/token.dto';

@ApiTags('universe')
@Controller('universe')
export class TokenController {
  constructor(private readonly tokens: TokenService) {}

  @Get(':token')
  @ApiOperation({
    summary: 'Почему он здесь и почему его нет',
    description:
      'Один ответ вместо ручной сборки из funnel, rejected, coverage и dataGaps: ' +
      'кто это, прошёл ли отбор, каким фильтром отсеян, какие числа известны, ' +
      'что посчитала оценка и что нужно сделать, чтобы картинка изменилась.\n\n' +
      'Тикера нет во вселенной — тоже 200, с inSnapshot: false и причиной. Сценарий ' +
      'начинается с ввода тикера, и 404 здесь худший из возможных ответов.\n\n' +
      'Один тикер у двух активов — 409 со списком кандидатов: тикер не идентификатор. ' +
      'Принимается и coingeckoId, он же стабильный идентификатор сущности.',
  })
  @ApiParam({ name: 'token', example: 'AAVE', description: 'Тикер или coingeckoId' })
  @ApiOkResponse({ type: TokenReportDto })
  @ApiResponse({ status: 409, type: ApiErrorDto, description: 'Неоднозначный тикер' })
  async report(@Param('token') token: string): Promise<TokenReport> {
    return this.tokens.report(token);
  }
}