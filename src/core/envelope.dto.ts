import { ApiProperty } from '@nestjs/swagger';
import { ActiveFilterStateDto } from './universe/filter-state.dto';

export class ResponseContextDto {
  @ApiProperty({ example: '2026-08-26' }) universeVersion!: string;
  @ApiProperty({ example: '2026-08-26T06:00:00.000Z' }) builtAt!: string;
  @ApiProperty({
    type: ActiveFilterStateDto,
    description: 'Чей это список. Композиция фильтров, а не свойство снимка',
  })
  activeFilters!: ActiveFilterStateDto;
  @ApiProperty({ example: '2026-08-29T09:12:00.000Z', description: 'Время ответа' })
  asOf!: string;
}

export class PaginationDto {
  @ApiProperty({ example: 0 }) offset!: number;
  @ApiProperty({ example: 50 }) limit!: number;
  @ApiProperty({ example: 331, description: 'Полное число строк, а не размер страницы' })
  total!: number;
  @ApiProperty({ example: true }) hasMore!: boolean;
}

export class NextActionDto {
  @ApiProperty({ example: 'POST' }) method!: string;
  @ApiProperty({ example: '/evaluation/run' }) path!: string;
  @ApiProperty({ type: 'object', additionalProperties: true, example: {} })
  body!: Record<string, unknown>;
}

export class ApiErrorDto {
  @ApiProperty({ example: 'universe_missing', description: 'Машиночитаемый и стабильный' })
  code!: string;
  @ApiProperty({ example: 'Состав вселенной ещё не собран: показывать нечего.' })
  message!: string;
  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: true,
    description: 'Что именно разошлось, поимённо',
  })
  details!: Record<string, unknown> | null;
  @ApiProperty({
    type: NextActionDto,
    nullable: true,
    description: 'null только там, где следующего вызова нет: править нужно сам запрос',
  })
  nextAction!: NextActionDto | null;
}