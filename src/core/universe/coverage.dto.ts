import { ApiProperty } from '@nestjs/swagger';
import { ActiveFilterStateDto } from './filter-state.dto';

export class CoverageBucketDto {
  @ApiProperty({ example: 'available' }) key!: string;
  @ApiProperty({ example: 165 }) count!: number;
  @ApiProperty({ example: 44.35 }) pct!: number;
  @ApiProperty({ example: 61_200_000_000 }) mcapUsd!: number;
  @ApiProperty({ example: 71.4 }) mcapPct!: number;
}

export class CoverageGapDto {
  @ApiProperty({ example: 'shuffle' }) coingeckoId!: string;
  @ApiProperty({ example: 'SHFL' }) ticker!: string;
  @ApiProperty({ nullable: true, example: 137_000_000 }) mcapCalcUsd!: number | null;
  @ApiProperty({ nullable: true, example: null }) sector!: string | null;
  @ApiProperty({ example: 'none' }) matchedBy!: string;
  @ApiProperty({ example: 'mapping_failed' }) revenueState!: string;
}

export class SectorCoverageDto {
  @ApiProperty({ example: 294 }) withGroup!: number;
  @ApiProperty({ example: 38 }) withoutGroup!: number;
  @ApiProperty({ example: 11.45, description: 'Доля без группы по числу монет' })
  gapPct!: number;
  @ApiProperty({
    example: 2.37,
    description: 'То же по капитализации: считается отдельно, XMR один стоит 8.4 млрд',
  })
  gapMcapPct!: number;
  @ApiProperty({ example: 15 }) maxGapPct!: number;
  @ApiProperty({ example: 15 }) maxGapMcapPct!: number;
  @ApiProperty({ example: true, description: 'false — гейт красный, достаточно провалить один порог' })
  passed!: boolean;
  @ApiProperty({ type: CoverageGapDto, isArray: true }) worst!: CoverageGapDto[];
}

export class RevenueCoverageDto {
  @ApiProperty({ type: CoverageBucketDto, isArray: true }) byState!: CoverageBucketDto[];
  @ApiProperty({ example: false, description: 'Гейта на выручке нет: сетям нужны свои метрики' })
  gated!: boolean;
}

export class CoverageGroupDto {
  @ApiProperty({ example: 'chain' }) group!: string;
  @ApiProperty({ example: 61 }) size!: number;
}

export class CoverageReportDto {
  @ApiProperty({ example: '2026-08-26' }) universeVersion!: string;
  @ApiProperty({ example: '2026-08-26T08:00:00.000Z' }) builtAt!: string;
  @ApiProperty({ type: ActiveFilterStateDto }) activeFilters!: ActiveFilterStateDto;
  @ApiProperty({ example: 332, description: 'База: вход альфы, сама альфа выключена' })
  total!: number;
  @ApiProperty({ example: 86_000_000_000 }) totalMcapUsd!: number;
  @ApiProperty({ type: SectorCoverageDto }) sector!: SectorCoverageDto;
  @ApiProperty({ type: RevenueCoverageDto }) revenue!: RevenueCoverageDto;
  @ApiProperty({ type: CoverageBucketDto, isArray: true }) archetypes!: CoverageBucketDto[];
  @ApiProperty({ type: CoverageGroupDto, isArray: true }) groups!: CoverageGroupDto[];
  @ApiProperty({ type: [String] }) warnings!: string[];
}