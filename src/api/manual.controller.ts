import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsNumber, IsPositive, IsString, IsUrl, Min } from 'class-validator';
import { ManualService } from '../core/manual/manual.service';
import type {
  ManualIncentiveOverrideLookup,
  ManualIncentiveOverrideRecord,
  ManualUnlockRecord,
} from '../core/manual/manual.types';

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

export class ManualIncentiveOverrideDto {
  @ApiProperty({
    example: 1_200_000,
    description: 'Стоимость раздаваемых токенов за 12 месяцев в USD. Подтверждённый ноль допустим',
  })
  @IsNumber()
  @Min(0)
  incentives12mUsd!: number;

  @ApiProperty({
    example: 'https://official.example/report',
    description: 'Обязательна и только http/https: число без источника обнуляется валидатором',
  })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  sourceUrl!: string;

  @ApiProperty({
    example: '2026-08-01T00:00:00.000Z',
    description: 'Дата документа-источника, а не время этого запроса',
  })
  @IsISO8601()
  asOf!: string;
}

export class ManualIncentiveOverrideRecordDto extends ManualIncentiveOverrideDto {
  @ApiProperty({ example: 'hyperliquid' }) coingeckoId!: string;
  @ApiProperty({ example: 'HYPE' }) ticker!: string;
  @ApiProperty({ example: 'manual', enum: ['manual'] }) origin!: 'manual';
  @ApiProperty({ example: '2026-08-27T09:12:00.000Z' }) createdAt!: string;
}

export class ManualIncentiveOverrideLookupDto {
  @ApiProperty({ example: 'hyperliquid' }) coingeckoId!: string;
  @ApiProperty({ example: 'HYPE' }) ticker!: string;
  @ApiProperty({
    type: ManualIncentiveOverrideRecordDto,
    nullable: true,
    description: 'null — override для этого токена не сохранён; это законное состояние',
  })
  override!: ManualIncentiveOverrideRecord | null;
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

  @Post('overrides/:token')
  @ApiOperation({
    summary: 'Сохранить ручной override стимулов [advanced]',
    description:
      'Стоимость раздаваемых токенов не приходит ни из CoinGecko, ни из сводок ' +
      'DeFiLlama. sourceUrl и asOf обязательны; подтверждённый ноль отличается от ' +
      'неизвестного значения, которое остаётся null и попадает в missing.\n\n' +
      'Повторная запись по тому же токену заменяет предыдущую: хранится ровно ' +
      'одна актуальная запись, а не история версий.',
  })
  @ApiOkResponse({ type: ManualIncentiveOverrideRecordDto })
  async setOverride(
    @Param('token') token: string,
    @Body() body: ManualIncentiveOverrideDto,
  ): Promise<ManualIncentiveOverrideRecord> {
    return this.manual.setIncentiveOverride(token, body);
  }

  @Get('overrides/:token')
  @ApiOperation({
    summary: 'Ручной override стимулов одного токена',
    description: 'Записи нет — законное состояние: override: null, а не ошибка.',
  })
  @ApiOkResponse({ type: ManualIncentiveOverrideLookupDto })
  async getOverride(@Param('token') token: string): Promise<ManualIncentiveOverrideLookup> {
    return this.manual.incentiveOverride(token);
  }
}