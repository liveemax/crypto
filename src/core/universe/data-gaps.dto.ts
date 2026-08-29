import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PaginationDto, ResponseContextDto } from '../envelope.dto';

const toBoolean = ({ value }: { value: unknown }): boolean | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  return value === true || value === 'true' || value === '1';
};

export class DataGapQueryDto {
  @ApiPropertyOptional({ default: true, description: 'Только строки рабочего отбора' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  passedOnly?: boolean;

  @ApiPropertyOptional({
    example: 'source_missing',
    description: 'Тип пробела. known_zero недоступен: подтверждённый ноль не задача',
  })
  @IsOptional()
  @IsString()
  dataState?: string;

  @ApiPropertyOptional({ example: 'chain' })
  @IsOptional()
  @IsString()
  assetArchetype?: string;

  @ApiPropertyOptional({ example: 'lending' })
  @IsOptional()
  @IsString()
  comparisonGroup?: string;

  @ApiPropertyOptional({ enum: ['revenue', 'tokenomics', 'comparisonGroup'] })
  @IsOptional()
  @IsIn(['revenue', 'tokenomics', 'comparisonGroup'])
  field?: 'revenue' | 'tokenomics' | 'comparisonGroup';

  @ApiPropertyOptional({ default: 50, description: 'По умолчанию 50, максимум 200' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class DataGapItemDto {
  @ApiProperty({ enum: ['revenue', 'tokenomics', 'comparisonGroup'], example: 'tokenomics' })
  field!: string;
  @ApiProperty({ example: 'source_missing' }) state!: string;
  @ApiProperty({ example: 'Календарь разлоков не покрыт: unlock12mPct и NHY остаются null, а не нулём' })
  note!: string;
  @ApiProperty({ example: 'Календаря у DeFiLlama нет: POST /manual/unlocks со ссылкой и датой закроет NHY' })
  fix!: string;
}

export class DataGapRowDto {
  @ApiProperty({ example: 'monero' }) coingeckoId!: string;
  @ApiProperty({ example: 'XMR' }) ticker!: string;
  @ApiProperty({ example: 'Monero' }) name!: string;
  @ApiProperty({ nullable: true, example: 8_000_000_000 }) mcapCalcUsd!: number | null;
  @ApiProperty({ example: 'chain' }) assetArchetype!: string;
  @ApiProperty({ nullable: true, example: null }) comparisonGroup!: string | null;
  @ApiProperty({ nullable: true, example: null }) sector!: string | null;
  @ApiProperty({ example: 'none' }) matchedBy!: string;
  @ApiProperty({ example: true }) passed!: boolean;
  @ApiProperty({ type: DataGapItemDto, isArray: true }) gaps!: DataGapItemDto[];
}

export class DataGapListResponseDto {
  @ApiProperty({ type: ResponseContextDto }) context!: ResponseContextDto;
  @ApiProperty({ type: PaginationDto }) pagination!: PaginationDto;
  @ApiProperty({ type: DataGapRowDto, isArray: true }) items!: DataGapRowDto[];
}