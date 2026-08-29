import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnalysisProfileDto } from '../core/universe/profile.dto';
import { BUILTIN_PROFILES } from './profiles';
import { ConfigThresholdsDto } from './config.dto';
import { MAX_STALE_DAYS, THRESHOLDS, WEIGHTS } from './thresholds';

@ApiTags('config')
@Controller('config')
export class ConfigController {
  /**
   * Возвращает встроенные профили с объяснением проверяемой гипотезы.
   * Голым массивом намеренно: список короткий, статический и происхождения не имеет.
   */
  @Get('profiles')
  @ApiOperation({
    summary: 'Встроенные профили анализа и их гипотезы',
    description:
      'Тело любого профиля можно передать в POST /universe/screen как разовый. ' +
      'Состава вселенной здесь нет: он живёт в GET /universe, и второй ответ на тот ' +
      'же вопрос всегда оказывается неверным.',
  })
  @ApiOkResponse({ type: AnalysisProfileDto, isArray: true })
  getProfiles(): AnalysisProfileDto[] {
    return [...BUILTIN_PROFILES];
  }

  /** Возвращает пороги, веса и срок актуальности метрик профиля по умолчанию. */
  @Get('thresholds')
  @ApiOperation({ summary: 'Пороги, веса композита и срок актуальности метрик' })
  @ApiOkResponse({ type: ConfigThresholdsDto })
  getThresholds(): ConfigThresholdsDto {
    return {
      thresholds: THRESHOLDS,
      weights: WEIGHTS,
      maxStaleDays: MAX_STALE_DAYS,
    };
  }
}