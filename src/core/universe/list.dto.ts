import { ApiProperty } from '@nestjs/swagger';
import { PaginationDto, ResponseContextDto } from '../envelope.dto';

/** Строка по умолчанию. Полная — UniverseCandidateDto, приходит по view=full. */
export class UniverseSummaryRowDto {
  @ApiProperty({ example: 12 }) rank!: number;
  @ApiProperty({ example: 'aave' }) coingeckoId!: string;
  @ApiProperty({ example: 'AAVE' }) ticker!: string;
  @ApiProperty({ example: 'Aave' }) name!: string;
  @ApiProperty({ nullable: true, example: 'lending' }) sector!: string | null;
  @ApiProperty({ nullable: true, example: 'lending' }) comparisonGroup!: string | null;
  @ApiProperty({ example: 'protocol' }) assetArchetype!: string;

  @ApiProperty({ nullable: true, example: 3_750_000_000 }) mcapCalcUsd!: number | null;
  @ApiProperty({ nullable: true, example: 200_000_000 }) vol24hUsd!: number | null;
  @ApiProperty({ nullable: true, example: 5.33 }) turnoverPct!: number | null;
  @ApiProperty({ nullable: true, example: 93.75 }) floatPct!: number | null;

  @ApiProperty({ nullable: true, example: 112_000_000 }) revenue12mUsd!: number | null;
  @ApiProperty({ nullable: true, example: 60_000_000 }) holdersRevenue12mUsd!: number | null;
  @ApiProperty({ nullable: true, example: 1.6 }) holderYieldPct!: number | null;
  @ApiProperty({ nullable: true, example: 33.5 }) pRev!: number | null;
  @ApiProperty({ nullable: true, example: 7.2 }) pFees!: number | null;

  @ApiProperty({ nullable: true, example: 6.7 }) overhangPct!: number | null;
  @ApiProperty({ nullable: true, example: null, description: 'null — календарь не покрыт, это не ноль' })
  unlock12mPct!: number | null;
  @ApiProperty({ nullable: true, example: null }) netHolderYieldPct!: number | null;

  @ApiProperty({ example: 'available' }) revenueState!: string;
  @ApiProperty({ example: 'source_missing' }) tokenomicsState!: string;

  @ApiProperty({ enum: ['yield', 'economics', 'pool', 'rejected'], example: 'yield' })
  tier!: string;
  @ApiProperty({ example: true }) passed!: boolean;
  @ApiProperty({ nullable: true, example: null }) rejectedAt!: string | null;
  @ApiProperty({ nullable: true, example: null }) rejectReason!: string | null;

  @ApiProperty({ nullable: true, example: 'kept_top_n' }) alphaDecision!: string | null;
  @ApiProperty({ nullable: true, example: 2 }) rankInSector!: number | null;
  @ApiProperty({ nullable: true, example: 9 }) sectorSize!: number | null;
}

/** Конверт списка кандидатов: голый массив не объясняет своё происхождение. */
export class UniverseListResponseDto {
  @ApiProperty({ type: ResponseContextDto }) context!: ResponseContextDto;
  @ApiProperty({ type: PaginationDto }) pagination!: PaginationDto;
  @ApiProperty({
    type: UniverseSummaryRowDto,
    isArray: true,
    description: 'view=summary — эта форма; view=full — кандидат целиком с перцентилями и peers',
  })
  items!: UniverseSummaryRowDto[];
}