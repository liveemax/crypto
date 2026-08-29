import { ApiProperty } from '@nestjs/swagger';
import { NextActionDto } from '../../core/envelope.dto';
import { ActiveFilterStateDto } from '../../core/universe/filter-state.dto';
import { FunnelTiersDto } from '../../core/universe/universe.dto';

export class JobSnapshotDto {
  @ApiProperty({ nullable: true, example: 'universe/tokenomics' }) operation!: string | null;
  @ApiProperty({ enum: ['idle', 'running', 'done', 'error'], example: 'running' }) state!: string;
  @ApiProperty({ example: 'tokenomics' }) step!: string;
  @ApiProperty({ example: 'Обход документов эмиссий' }) label!: string;
  @ApiProperty({ example: 229 }) current!: number;
  @ApiProperty({ example: 370 }) total!: number;
  @ApiProperty({ example: 62 }) percent!: number;
  @ApiProperty({ example: 1_300 }) loaded!: number;
  @ApiProperty({ example: 0 }) failures!: number;
  @ApiProperty({ nullable: true, example: '2026-08-29T09:11:12.000Z' }) startedAt!: string | null;
  @ApiProperty({ nullable: true, example: null }) finishedAt!: string | null;
  @ApiProperty({ example: 48 }) elapsedSec!: number;
  @ApiProperty({ nullable: true, example: 30 }) etaSec!: number | null;
  @ApiProperty({ nullable: true, example: null }) lastError!: string | null;
}

export class UniverseFreshnessDto {
  @ApiProperty({ nullable: true, example: '2026-08-26' }) version!: string | null;
  @ApiProperty({ nullable: true, example: '2026-08-26T06:00:00.000Z' }) builtAt!: string | null;
  @ApiProperty({ nullable: true, example: 3 }) ageDays!: number | null;
  @ApiProperty({ nullable: true, example: 1_300 }) total!: number | null;
}

export class LayerFreshnessDto {
  @ApiProperty({ nullable: true, example: '2026-08-29T06:00:00.000Z', description: 'Время источника' })
  asOf!: string | null;
  @ApiProperty({ nullable: true, example: 3 }) ageHours!: number | null;
  @ApiProperty({
    example: 77.96,
    description: 'Доля полной вселенной, а не выборки: фильтр не должен улучшать метрику',
  })
  coveragePct!: number;
}

export class StatusDataDto {
  @ApiProperty({ type: UniverseFreshnessDto }) universe!: UniverseFreshnessDto;
  @ApiProperty({ type: LayerFreshnessDto }) prices!: LayerFreshnessDto;
  @ApiProperty({ type: LayerFreshnessDto }) tokenomics!: LayerFreshnessDto;
}

export class SelectionStatusDto {
  @ApiProperty({ type: ActiveFilterStateDto }) activeFilters!: ActiveFilterStateDto;
  @ApiProperty({ nullable: true, example: 1_300 }) total!: number | null;
  @ApiProperty({ nullable: true, example: 331 }) passed!: number | null;
  @ApiProperty({ type: FunnelTiersDto, nullable: true }) dataTiers!: FunnelTiersDto | null;
}

export class EvaluationCompatibleDto {
  @ApiProperty({ example: true, description: 'Числа и профиль те же: valuation и tokenomics годны' })
  perToken!: boolean;
  @ApiProperty({ example: false, description: 'Состав группы сравнения тот же: годен sectorPosition' })
  comparative!: boolean;
}

export class EvaluationStatusDto {
  @ApiProperty({ example: 'eval_2026-08-28T09-12-00-000Z_deep-value' }) runId!: string;
  @ApiProperty({ example: '2026-08-28T09:12:00.000Z' }) createdAt!: string;
  @ApiProperty({ example: 'deep-value' }) evaluationProfileId!: string;
  @ApiProperty({ example: 331 }) evaluatedCount!: number;
  @ApiProperty({ type: EvaluationCompatibleDto }) compatible!: EvaluationCompatibleDto;
}

export class StatusNextActionDto extends NextActionDto {
  @ApiProperty({ example: 'Состав выборки изменился после последней оценки' }) why!: string;
}

export class StatusReportDto {
  @ApiProperty({ type: JobSnapshotDto }) job!: JobSnapshotDto;
  @ApiProperty({ type: StatusDataDto }) data!: StatusDataDto;
  @ApiProperty({ type: SelectionStatusDto }) selection!: SelectionStatusDto;
  @ApiProperty({ type: EvaluationStatusDto, nullable: true })
  evaluation!: EvaluationStatusDto | null;
  @ApiProperty({ type: StatusNextActionDto }) nextAction!: StatusNextActionDto;
}