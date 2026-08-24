import { ApiProperty } from '@nestjs/swagger';

export class UniverseItemDto {
  @ApiProperty({ example: 'AAVE' })
  ticker!: string;

  @ApiProperty({ example: 'Aave' })
  name!: string;

  @ApiProperty({ example: 'lending' })
  sector!: string;

  @ApiProperty({ example: 'aave' })
  defillama!: string;

  @ApiProperty({ example: 'aave' })
  coingecko!: string;
}

export class SectorDto {
  @ApiProperty({ example: 'lending' })
  sector!: string;

  @ApiProperty({ example: 2 })
  projects!: number;
}

export class ScreenerThresholdsDto {
  @ApiProperty({ example: 50_000_000 })
  minMcapUsd!: number;

  @ApiProperty({ example: 1_000_000 })
  minAnnualRevenueUsd!: number;

  @ApiProperty({ example: 60 })
  maxPRev!: number;
}

export class CompositeWeightsDto {
  @ApiProperty({ example: 0.25 })
  valueCapture!: number;

  @ApiProperty({ example: 0.2 })
  revenueQuality!: number;

  @ApiProperty({ example: 0.25 })
  unlocks!: number;

  @ApiProperty({ example: 0.15 })
  sectorPosition!: number;

  @ApiProperty({ example: 0.15 })
  organic!: number;
}

export class ConfigThresholdsDto {
  @ApiProperty({ type: ScreenerThresholdsDto })
  thresholds!: ScreenerThresholdsDto;

  @ApiProperty({ type: CompositeWeightsDto })
  weights!: CompositeWeightsDto;

  @ApiProperty({ example: 45 })
  maxStaleDays!: number;
}
