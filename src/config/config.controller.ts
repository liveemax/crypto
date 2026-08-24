import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigThresholdsDto, SectorDto, UniverseItemDto } from './config.dto';
import { MAX_STALE_DAYS, THRESHOLDS, WEIGHTS } from './thresholds';
import { sectors, UNIVERSE } from './universe';

@ApiTags('config')
@Controller('config')
export class ConfigController {
  /** Возвращает полный список анализируемых активов. */
  @Get('universe')
  @ApiOperation({ summary: 'Получить вселенную анализируемых активов' })
  @ApiOkResponse({ type: UniverseItemDto, isArray: true })
  getUniverse(): UniverseItemDto[] {
    return UNIVERSE;
  }

  /** Возвращает секторы и количество проектов в каждом из них. */
  @Get('sectors')
  @ApiOperation({ summary: 'Получить секторы и количество проектов' })
  @ApiOkResponse({ type: SectorDto, isArray: true })
  getSectors(): SectorDto[] {
    return sectors().map((sector) => ({
      sector,
      projects: UNIVERSE.filter((item) => item.sector === sector).length,
    }));
  }

  /** Возвращает пороги, веса и срок актуальности метрик. */
  @Get('thresholds')
  @ApiOperation({ summary: 'Получить пороги и веса аналитики' })
  @ApiOkResponse({ type: ConfigThresholdsDto })
  getThresholds(): ConfigThresholdsDto {
    return {
      thresholds: THRESHOLDS,
      weights: WEIGHTS,
      maxStaleDays: MAX_STALE_DAYS,
    };
  }
}
