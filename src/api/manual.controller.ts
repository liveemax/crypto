import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsNumber, IsPositive, IsString, IsUrl } from 'class-validator';
import { ManualService } from '../core/manual/manual.service';
import type { ManualUnlockRecord } from '../core/manual/manual.types';

const CATEGORIES = ['team', 'investors', 'community', 'ecosystem', 'other', 'unknown'];

export class ManualUnlockDto {
  @ApiProperty({ example: 'HYPE', description: 'Тикер или coingeckoId из GET /universe' })
  @IsString()
  ticker!: string;

  @ApiProperty({ example: '2026-11-29T00:00:00.000Z', description: 'Дата разлока' })
  @IsISO8601()
  date!: string;

  @ApiProperty({ example: 9_600_000, description: 'Токенов к разлоку, не USD' })
  @IsNumber()
  @IsPositive()
  tokens!: number;

  @ApiProperty({ enum: CATEGORIES, example: 'team' })
  @IsIn(CATEGORIES)
  category!: string;

  @ApiProperty({
    example: 'https://hyperfoundation.org/tokenomics',
    description: 'Обязательна: число без источника обнуляется валидатором',
  })
  @IsUrl()
  sourceUrl!: string;

  @ApiProperty({
    example: '2026-08-14T00:00:00.000Z',
    description: 'Дата документа-источника, а не время этого запроса',
  })
  @IsISO8601()
  asOf!: string;
}

export class ManualUnlockRecordDto extends ManualUnlockDto {
  @ApiProperty({ example: 'unlock_2f7a...' }) id!: string;
  @ApiProperty({ example: 'hyperliquid' }) coingeckoId!: string;
  @ApiProperty({ example: '2026-08-27T09:12:00.000Z' }) createdAt!: string;
}

@ApiTags('manual')
@Controller('manual')
export class ManualController {
  constructor(private readonly manual: ManualService) {}

  @Post('unlocks')
  @ApiOperation({
    summary: 'Добавить разлок руками [advanced]',
    description:
      'Необязательный слой: он дополняет автоматический источник там, где тот ' +
      'токен не знает, и никогда не является условием прохождения оценки.\n\n' +
      'sourceUrl и asOf обязательны. Если источник по этому токену календарь ' +
      'отдал, берётся его значение, а расхождение более чем вдвое попадает в ' +
      'note — тихо предпочесть ручной ввод нельзя.\n\n' +
      'Запись видна как origin: manual и попадает в числа при следующем ' +
      'POST /universe/tokenomics.',
  })
  @ApiOkResponse({ type: ManualUnlockRecordDto })
  async add(@Body() body: ManualUnlockDto): Promise<ManualUnlockRecord> {
    return this.manual.addUnlock({ ...body, category: body.category as ManualUnlockRecord['category'] });
  }

  @Get('unlocks/:token')
  @ApiOperation({ summary: 'Ручные разлоки одного токена' })
  @ApiOkResponse({ type: ManualUnlockRecordDto, isArray: true })
  async list(@Param('token') token: string): Promise<ManualUnlockRecord[]> {
    return this.manual.unlocks(token);
  }

  @Delete('unlocks/:id')
  @ApiOperation({ summary: 'Удалить ручной разлок по идентификатору' })
  async remove(@Param('id') id: string): Promise<{ deleted: string }> {
    await this.manual.removeUnlock(id);
    return { deleted: id };
  }
}