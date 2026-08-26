import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { AlphaConfigDto, AnalysisProfileDto } from './profile.dto';

export class ScreenSelectionDto {
  @ApiProperty({
    example: true,
    description:
      'true — включить фильтр шлака, false — выключить. Выключение возвращает ' +
      'ровно тот состав, что был без него; конфигурация при этом сохраняется',
  })
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({
    example: 'deep-value',
    enum: ['default', 'yield-hunter', 'deep-value'],
    description: 'Готовый профиль. Вместе с profile — ошибка, при enabled: false — ошибка',
  })
  @IsOptional()
  @IsString()
  profileId?: string;

  @ApiPropertyOptional({
    type: AnalysisProfileDto,
    description: 'Разовый профиль целиком, если готовые не подходят',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AnalysisProfileDto)
  profile?: AnalysisProfileDto;
}

export class ScreenFilterStateDto {
  @ApiProperty({ example: true }) enabled!: boolean;
  @ApiProperty({ nullable: true, example: 'deep-value' }) profileId!: string | null;
  @ApiProperty({
    type: AnalysisProfileDto,
    nullable: true,
    description: 'Конфигурация целиком: по одному имени результат не воспроизводится',
  })
  profile!: AnalysisProfileDto | null;
}

export class AlphaFilterStateDto {
  @ApiProperty({ example: false, description: 'До шага 06 всегда false' })
  enabled!: boolean;
  @ApiProperty({ nullable: true, example: null }) profileId!: string | null;
  @ApiProperty({ type: AlphaConfigDto, nullable: true }) config!: AlphaConfigDto | null;
}

export class ActiveFilterStateDto {
  @ApiProperty({ type: ScreenFilterStateDto }) screen!: ScreenFilterStateDto;
  @ApiProperty({ type: AlphaFilterStateDto }) alpha!: AlphaFilterStateDto;
}