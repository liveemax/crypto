import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class MetricDto {
  @ApiProperty({
    description: 'Значение. null — метрика обнулена валидатором либо не измерена',
    nullable: true,
    oneOf: [{ type: 'number' }, { type: 'string' }],
    example: 3_750_000_000,
  })
  value!: number | string | null;

  @ApiProperty({ description: 'Единица измерения', example: 'USD' })
  unit!: string;

  @ApiProperty({
    description: 'Страница, откуда пришло число. Ключи API сюда не попадают',
    nullable: true,
    example: 'https://api.coingecko.com/api/v3/coins/markets',
  })
  sourceUrl!: string | null;

  @ApiProperty({
    description: 'Время обновления НА СТОРОНЕ ИСТОЧНИКА, а не время нашего запроса',
    nullable: true,
    example: '2026-08-26T09:12:00.000Z',
  })
  asOf!: string | null;

  @ApiPropertyOptional({
    description: 'Почему значение обнулено: число без происхождения — не число',
    enum: ['no_source', 'no_as_of'],
  })
  droppedReason?: 'no_source' | 'no_as_of';

  @ApiPropertyOptional({ description: 'Насколько устарел источник, дней', example: 61 })
  staleDays?: number;
}

@ApiExtraModels(MetricDto)
export class AgentResultDto {
  @ApiProperty({ example: 'screener' }) agent!: string;
  @ApiProperty({ example: 'Дешевизна относительно выручки' }) title!: string;
  @ApiProperty({ example: 'AAVE' }) token!: string;
  @ApiProperty({ nullable: true, example: 'lending' }) sector!: string | null;

  @ApiProperty({
    description: 'Время расчёта. Пришло старое — ответ из дневного кэша, см. refresh',
    example: '2026-08-26T09:15:00.000Z',
  })
  asOf!: string;

  @ApiProperty({
    description: 'Вывод агента: набор полей зависит от агента',
    type: 'object',
    additionalProperties: true,
    example: { passed: false, failedChecks: ['выручка без подтверждённого источника'] },
  })
  verdict!: Record<string, unknown>;

  @ApiProperty({
    description: 'Балл 0..100. null — данных не хватило: отказ честнее правдоподобия',
    nullable: true,
    example: null,
  })
  score!: number | null;

  @ApiPropertyOptional({ description: 'Балл до множителя качества данных', example: 80 })
  scoreRaw?: number;

  @ApiProperty({
    description:
      'Метрики агента; у каждой ссылка на источник и время источника. ' +
      'Пример показывает форму ответа, а не измеренные числа',
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(MetricDto) },
    example: {
      mcapUsd: {
        value: 3_750_000_000,
        unit: 'USD',
        sourceUrl: 'https://api.coingecko.com/api/v3/coins/markets',
        asOf: '2026-08-26T09:12:00.000Z',
      },
      revenue12mUsd: {
        value: null,
        unit: 'USD',
        sourceUrl: null,
        asOf: '2026-08-26T06:00:00.000Z',
        droppedReason: 'no_source',
      },
    },
  })
  metrics!: Record<string, MetricDto>;

  @ApiProperty({ description: 'Доля заполненных метрик, 0..1', example: 0.5 })
  dataQuality!: number;

  @ApiProperty({ type: [String], example: ['revenue12mUsd'] })
  missing!: string[];

  @ApiProperty({ example: 'Источник выручки не подтверждён, балл не выставлен.' })
  notes!: string;

  @ApiPropertyOptional({
    description: 'Что обнулил и что счёл устаревшим валидатор происхождения',
    type: 'object',
    additionalProperties: true,
    example: { dropped: ['revenue12mUsd'], stale: [] },
  })
  validator?: { dropped: string[]; stale: string[] };

  @ApiPropertyOptional({ description: 'Сбой внутри агента, а не отсутствие данных' })
  error?: string;
}

export class AgentInfoDto {
  @ApiProperty({ example: 'screener' }) name!: string;
  @ApiProperty({ example: 'Дешевизна относительно выручки' }) title!: string;
  @ApiProperty({ description: 'Нужен ключ модели', example: false }) needsLlm!: boolean;

  @ApiProperty({
    type: [String],
    description: 'Поля снапшота, без которых результат будет частичным',
    example: ['mcapUsd'],
  })
  needs!: string[];
}

export class AgentRunQueryDto {
  @ApiPropertyOptional({
    description: 'Считать только по локальному снапшоту, во внешние API не ходить',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  offline?: boolean;

  @ApiPropertyOptional({
    description: 'Пересчитать, игнорируя дневной кэш результата',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  refresh?: boolean;

  @ApiPropertyOptional({
    description: 'Профиль анализа: пороги хард-фильтров берутся из него. Список — GET /config/profiles',
    example: 'deep-value',
  })
  @IsOptional()
  @IsString()
  profileId?: string;
}