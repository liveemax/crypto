import { Body, Controller, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { RefreshUniverseResponseDto } from '../core/universe/universe.dto';
import { TokenomicsService } from '../core/tokenomics/tokenomics.service';

export class RefreshTokenomicsDto {
  @ApiPropertyOptional({
    description: 'Пересобрать карту и перекачать документы, минуя суточный кэш',
    example: false,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === null || value === '' ? undefined : value === true || value === 'true' || value === '1',
  )
  @IsBoolean()
  force?: boolean;
}

@ApiTags('universe')
@Controller('universe')
export class TokenomicsController {
  constructor(private readonly tokenomics: TokenomicsService) {}

  @Post('tokenomics')
  @HttpCode(202)
  @ApiSecurity('admin-key')
  @ApiOperation({
    summary: 'ШАГ 2.5. Собрать календарь разлоков для всей вселенной',
    description:
      'Один вызов на всю вселенную, параметра токена нет. Тянет публичные ' +
      'датасеты эмиссий DeFiLlama, кладёт сырые ответы на диск и заполняет у ' +
      'кандидатов разлоки, разводнение и NHY со ссылкой и датой источника.\n\n' +
      'Работает в фоне: ответ приходит сразу, ход — в GET /universe/status.\n\n' +
      'Карта «монета → документ» строится обходом всех календарей и живёт сроком ' +
      'вселенной, поэтому первый прогон после POST /universe/refresh дольше ' +
      'остальных. Повтор в течение суток в сеть не ходит и только пересчитывает ' +
      'проценты по свежим ценам; force=true обходит кэш.\n\n' +
      'Состав, version и builtAt не меняются — меняются только числа. Непокрытый ' +
      'токен получает типизированное состояние в tokenomicsState, а не ноль.',
  })
  @ApiBody({ type: RefreshTokenomicsDto, required: false })
  @ApiResponse({ status: 202, type: RefreshUniverseResponseDto })
  async refresh(
    @Query() query: RefreshTokenomicsDto,
    @Body() body: RefreshTokenomicsDto = {},
  ): Promise<RefreshUniverseResponseDto> {
    return this.tokenomics.refresh({ force: query.force ?? body.force });
  }
}