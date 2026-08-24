import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsOptional, IsString } from "class-validator";
import { Transform } from "class-transformer";

export class RefreshSnapshotDto {
  @ApiPropertyOptional({ type: [String], example: ["AAVE"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tickers?: string[];
}

export class SnapshotQueryDto {
  @ApiPropertyOptional({
    description: "Не обращаться к внешним API",
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  offline?: boolean;
}

export class SnapshotRowDto {
  @ApiProperty({ example: "AAVE" }) ticker!: string;
  @ApiProperty({ example: "Aave" }) name!: string;
  @ApiProperty({ example: "lending" }) sector!: string;
  @ApiProperty({ example: "2026-08-24T12:00:00.000Z" }) asOf!: string;
  @ApiProperty({ nullable: true, example: 250 }) priceUsd!: number | null;
  @ApiProperty({ nullable: true, example: 4_000_000_000 }) mcapUsd!:
    | number
    | null;
  @ApiProperty({ nullable: true }) fdvUsd!: number | null;
  @ApiProperty({ nullable: true }) vol24hUsd!: number | null;
  @ApiProperty({ nullable: true }) circulating!: number | null;
  @ApiProperty({ nullable: true }) totalSupply!: number | null;
  @ApiProperty({ nullable: true }) revenue1y!: number | null;
  @ApiProperty({ nullable: true }) revenue30d!: number | null;
  @ApiProperty({ nullable: true }) tvlUsd!: number | null;
  @ApiProperty({ nullable: true }) mcapSource!: string | null;
  @ApiProperty({ nullable: true }) feesSource!: string | null;
  @ApiProperty({ nullable: true }) tvlSource!: string | null;
  @ApiProperty({ type: [String] }) errors!: string[];
}
