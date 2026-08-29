import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { AlphaConfigDto } from './profile.dto';

const DECISIONS = [
  'kept_top_n',
  'sector_not_saturated',
  'alpha_outranked',
  'alpha_unrankable',
  'alpha_missing_sector',
];

export class AlphaSelectionDto {
  @ApiProperty({
    example: true,
    description:
      'true — включить отбор лидеров ниш, false — выключить и вернуть отсеянных им',
  })
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({
    example: 'deep-value',
    enum: ['default', 'yield-hunter', 'deep-value'],
    description: 'Взять конфигурацию альфы из готового профиля',
  })
  @IsOptional()
  @IsString()
  profileId?: string;

  @ApiPropertyOptional({
    type: AlphaConfigDto,
    description: 'Разовая конфигурация. Вместе с profileId — ошибка',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AlphaConfigDto)
  alpha?: AlphaConfigDto;
}

export class SectorPercentileDto {
  @ApiProperty({ example: 'holderYieldPct' }) field!: string;
  @ApiProperty({ enum: ['higher_better', 'lower_better'] }) direction!: string;
  @ApiProperty({ nullable: true, example: 2.07 }) value!: number | null;
  @ApiProperty({
    nullable: true,
    example: 83.33,
    description:
      'Скольких конкурентов сектора обошёл, %. null — число неизвестно, ' +
      'сравнивать не с чем или это выброс: ноль здесь означал бы худшего',
  })
  percentile!: number | null;
  @ApiProperty({ example: 6 }) ranked!: number;
  @ApiProperty({ nullable: true, example: 'https://defillama.com/protocol/aave' }) sourceUrl!: string | null;
  @ApiProperty({ nullable: true, example: '2026-08-29T00:00:00.000Z' }) asOf!: string | null;
}

export class AlphaViewDto {
  @ApiProperty({ example: 10 }) sectorSize!: number;
  @ApiProperty({ nullable: true, example: 1 }) rankInSector!: number | null;
  @ApiProperty({ nullable: true, example: 82.99 }) businessScaleScore!: number | null;
  @ApiProperty({ nullable: true, example: 1 }) tvlRank!: number | null;
  @ApiProperty({ nullable: true, example: 1 }) revenueRank!: number | null;
  @ApiProperty({ example: 6 }) tvlRanked!: number;
  @ApiProperty({ example: 6 }) revenueRanked!: number;
  @ApiProperty({ nullable: true, example: 42.1 }) tvlSharePct!: number | null;
  @ApiProperty({ type: SectorPercentileDto, isArray: true })
  percentiles!: SectorPercentileDto[];
  @ApiProperty({
    nullable: true,
    example: 35.38,
    description: 'Доля в выручке сектора: производное поле ответа, не поле кандидата',
  })
  revenueSharePct!: number | null;
  @ApiProperty({ example: true }) comparisonAvailable!: boolean;
  @ApiProperty({ example: true }) alphaQualified!: boolean;
  @ApiProperty({ enum: ['sector_leader', 'outranked', 'insufficient_data', 'sector_not_saturated', 'missing_sector'] }) alphaStatus!: string;
  @ApiProperty({
    enum: DECISIONS,
    example: 'kept_top_n',
    description:
      'sector_not_saturated — сектор мал, отбирать не из чего; ' +
      'alpha_outranked — проиграл конкуренцию; alpha_unrankable и ' +
      'alpha_missing_sector — пробел в данных, а не вердикт о токене',
  })
  decision!: string;
  @ApiProperty({ example: 'Место 1 из 6 сравнимых в секторе dexs' })
  decisionReason!: string;
  @ApiProperty({ type: [String], example: ['CAKE', 'CETUS', 'RAY'] }) peers!: string[];
}

export class AlphaSectorSummaryDto {
  @ApiProperty({ nullable: true, example: 'dexs' }) sector!: string | null;
  @ApiProperty({ example: 10 }) size!: number;
  @ApiProperty({ example: true, description: 'Участников больше perSector — только такие режутся' })
  saturated!: boolean;
  @ApiProperty({ example: 5 }) kept!: number;
  @ApiProperty({ example: 5 }) dropped!: number;
  @ApiProperty({ example: 9, description: 'Скольких удалось сравнить' }) ranked!: number;
}

export class AlphaDataGapDto {
  @ApiProperty({ example: 'litecoin' }) coingeckoId!: string;
  @ApiProperty({ example: 'LTC' }) ticker!: string;
  @ApiProperty({ nullable: true, example: 'chain' }) sector!: string | null;
  @ApiProperty({ enum: ['alpha_unrankable', 'alpha_missing_sector'] }) reason!: string;
  @ApiProperty({ type: [String], example: ['revenue12mUsd'] }) availableMetrics!: string[];
  @ApiProperty({ type: [String], example: ['holderYieldPct', 'pRev'] })
  missingMetrics!: string[];
  @ApiProperty({ example: 'Сравнить не с чем: известных метрик меньше 2 из 4' })
  note!: string;
}
