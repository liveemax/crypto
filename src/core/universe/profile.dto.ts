import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { NUMERIC_FIELDS } from './profile.types';

export class ScreenRuleDto {
  @ApiProperty({ example: 'liquid' })
  @IsString()
  stage!: string;

  @ApiProperty({ example: 'Суточный объём не ниже 500 000 USD' })
  @IsString()
  label!: string;

  @ApiProperty({ enum: ['compare', 'excluded', 'pegged', 'derivative', 'healthy'] })
  @IsIn(['compare', 'excluded', 'pegged', 'derivative', 'healthy'])
  kind!: string;

  @ApiPropertyOptional({ enum: NUMERIC_FIELDS, example: 'vol24hUsd' })
  @IsOptional()
  @IsIn(NUMERIC_FIELDS)
  field?: string;

  @ApiPropertyOptional({ enum: ['gte', 'lte'], example: 'gte' })
  @IsOptional()
  @IsIn(['gte', 'lte'])
  op?: string;

  @ApiPropertyOptional({ example: 500_000 })
  @IsOptional()
  @IsNumber()
  value?: number;

  @ApiPropertyOptional({ enum: ['pass', 'fail'], example: 'fail' })
  @IsOptional()
  @IsIn(['pass', 'fail'])
  nullPolicy?: string;
}

export class RankMetricDto {
  @ApiProperty({ enum: NUMERIC_FIELDS, example: 'holderYieldPct' })
  @IsIn(NUMERIC_FIELDS)
  field!: string;

  @ApiProperty({ enum: ['higher_better', 'lower_better'] })
  @IsIn(['higher_better', 'lower_better'])
  direction!: string;
}

export class AlphaConfigDto {
  @ApiProperty({
    example: 5,
    description:
      'Сколько участников оставлять в перенасыщенном секторе. Сектор размером ' +
      'не больше этого числа не режется вовсе, включая сектор из одного',
  })
  @IsInt()
  @Min(1)
  perSector!: number;

  @ApiProperty({
    example: 3,
    description: 'Минимум известных значений в секторе, чтобы метрика дала перцентиль',
  })
  @IsInt()
  @Min(1)
  minRankedValues!: number;

  @ApiProperty({
    example: 2,
    description:
      'Минимум непустых перцентилей, чтобы участник считался сравнимым. ' +
      'Меньше — пробел в данных, а не последнее место',
  })
  @IsInt()
  @Min(1)
  minScoreMetrics!: number;

  @ApiProperty({ type: RankMetricDto, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RankMetricDto)
  rankBy!: RankMetricDto[];
}

export class ProfileThresholdsDto {
  @ApiProperty({ example: 50_000_000 }) @IsNumber() @Min(0) minMcapUsd!: number;
  @ApiProperty({ example: 1_000_000 }) @IsNumber() @Min(0) minAnnualRevenueUsd!: number;
  @ApiProperty({ example: 60 }) @IsNumber() @Min(0) maxPRev!: number;
}

export class TierCutsDto {
  @ApiProperty({ example: 70 }) @IsNumber() @Min(0) @Max(100) a!: number;
  @ApiProperty({ example: 45 }) @IsNumber() @Min(0) @Max(100) b!: number;
  @ApiProperty({ example: 0.5 }) @IsNumber() @Min(0) @Max(1) minDataQuality!: number;
}

export class AnalysisProfileDto {
  @ApiProperty({ example: 'yield-hunter' }) @IsString() id!: string;
  @ApiProperty({ example: 'Доходность держателя' }) @IsString() title!: string;
  @ApiProperty({ description: 'Проверяемая гипотеза профиля' }) @IsString() rationale!: string;

  @ApiProperty({ type: ScreenRuleDto, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScreenRuleDto)
  screen!: ScreenRuleDto[];

  @ApiProperty({ type: AlphaConfigDto })
  @ValidateNested()
  @Type(() => AlphaConfigDto)
  alpha!: AlphaConfigDto;

  @ApiProperty({ type: ProfileThresholdsDto })
  @ValidateNested()
  @Type(() => ProfileThresholdsDto)
  thresholds!: ProfileThresholdsDto;

  @ApiProperty({ type: [String], example: ['screener', 'unlocks', 'mechanism'] })
  @IsArray()
  @IsString({ each: true })
  agents!: string[];

  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  @IsObject()
  weights!: Record<string, number>;

  @ApiProperty({ type: TierCutsDto })
  @ValidateNested()
  @Type(() => TierCutsDto)
  tierCuts!: TierCutsDto;
}

export class ProfileSelectionDto {
  @ApiPropertyOptional({ example: 'default' })
  @IsOptional()
  @IsString()
  profileId?: string;

  @ApiPropertyOptional({ type: AnalysisProfileDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AnalysisProfileDto)
  profile?: AnalysisProfileDto;
}

@ApiExtraModels(ProfileSelectionDto, AnalysisProfileDto)
export class CompareUniverseDto {
  @ApiProperty({
    description: 'Идентификатор или полный разовый профиль',
    oneOf: [
      { type: 'string', example: 'default' },
      { $ref: getSchemaPath(ProfileSelectionDto) },
      { $ref: getSchemaPath(AnalysisProfileDto) },
    ],
  })
  @IsDefined()
  left!: string | ProfileSelectionDto | AnalysisProfileDto;

  @ApiProperty({
    description: 'Идентификатор или полный разовый профиль',
    oneOf: [
      { type: 'string', example: 'yield-hunter' },
      { $ref: getSchemaPath(ProfileSelectionDto) },
      { $ref: getSchemaPath(AnalysisProfileDto) },
    ],
  })
  @IsDefined()
  right!: string | ProfileSelectionDto | AnalysisProfileDto;
}
