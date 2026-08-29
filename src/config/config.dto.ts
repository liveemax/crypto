import { ApiProperty } from '@nestjs/swagger';

export class ScreenerThresholdsDto {
  @ApiProperty({ example: 50_000_000 })
  minMcapUsd!: number;

  @ApiProperty({ example: 1_000_000 })
  minAnnualRevenueUsd!: number;

  @ApiProperty({ example: 60 })
  maxPRev!: number;
}

export class CompositeWeightsDto {
  @ApiProperty({ example: 0.35, description: 'NHY: доход держателя минус разводнение' })
  tokenomics!: number;

  @ApiProperty({ example: 0.25, description: 'Механизм возврата ценности и качество роста' })
  mechanism!: number;

  @ApiProperty({ example: 0.2, description: 'Дешевизна относительно собственной выручки' })
  valuation!: number;

  @ApiProperty({ example: 0.2, description: 'Положение среди прямых конкурентов' })
  sectorPosition!: number;
}

export class ConfigThresholdsDto {
  @ApiProperty({ type: ScreenerThresholdsDto })
  thresholds!: ScreenerThresholdsDto;

  @ApiProperty({ type: CompositeWeightsDto })
  weights!: CompositeWeightsDto;

  @ApiProperty({ example: 45 })
  maxStaleDays!: number;
}
