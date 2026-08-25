import { ApiProperty } from '@nestjs/swagger';
import { AlphaConfigDto } from './profile.dto';

export class SectorMemberDto {
  @ApiProperty({ example: 'uniswap' }) coingeckoId!: string;
  @ApiProperty({ example: 'UNI' }) ticker!: string;
  @ApiProperty({ example: 'Uniswap' }) name!: string;
  @ApiProperty({ enum: ['yield', 'economics', 'pool', 'rejected'], example: 'yield' })
  tier!: string;
}

export class SectorPercentileDto {
  @ApiProperty({ example: 'holderYieldPct' }) field!: string;
  @ApiProperty({ enum: ['higher_better', 'lower_better'], example: 'higher_better' })
  direction!: string;
  @ApiProperty({ nullable: true, example: 2.07, description: 'Само число кандидата' })
  value!: number | null;
  @ApiProperty({
    nullable: true,
    example: 83.33,
    description:
      'Скольких конкурентов сектора обошёл, % (равные делят место пополам). ' +
      'null — число неизвестно, сравнивать не с чем или это выброс: это не ноль',
  })
  percentile!: number | null;
  @ApiProperty({ example: 6, description: 'У скольких участников сектора это число есть' })
  ranked!: number;
}

export class SectorLeaderDto extends SectorMemberDto {
  @ApiProperty({ example: 'dexs' }) sector!: string;
  @ApiProperty({ example: 1, description: 'Место среди прошедших qualify' })
  rankInSector!: number;
  @ApiProperty({ example: 12, description: 'Участников сектора, с кем считались перцентили' })
  sectorSize!: number;
  @ApiProperty({ example: 4, description: 'Сколько участников прошли абсолютный порог' })
  qualifiedInSector!: number;
  @ApiProperty({ example: 81.25, description: 'Среднее доступных перцентилей' })
  sectorScore!: number;
  @ApiProperty({ type: SectorPercentileDto, isArray: true })
  percentiles!: SectorPercentileDto[];
  @ApiProperty({
    nullable: true,
    example: 27.52,
    description: 'Доля в выручке сектора: revenue12mUsd к сумме выручки участников, %',
  })
  revenueSharePct!: number | null;
  @ApiProperty({ nullable: true, example: 1_933_800_000 }) mcapCalcUsd!: number | null;
  @ApiProperty({ nullable: true, example: 107_000_000 }) revenue12mUsd!: number | null;
  @ApiProperty({ nullable: true, example: 40_000_000 })
  holdersRevenue12mUsd!: number | null;
  @ApiProperty({ nullable: true, example: 2.07 }) holderYieldPct!: number | null;
  @ApiProperty({ nullable: true, example: 18.5 }) pRev!: number | null;
  @ApiProperty({ nullable: true, example: 'https://defillama.com/protocol/aave-v3' })
  revenueSource!: string | null;
  @ApiProperty({ nullable: true, example: '2026-08-25T10:00:00.000Z' })
  marketAsOf!: string | null;
  @ApiProperty({
    type: [String],
    example: ['CRV', 'CAKE', 'SUSHI'],
    description: 'С кем шло сравнение; сам лидер в список не входит',
  })
  peers!: string[];
}

export class SectorWithoutComparisonDto {
  @ApiProperty({ nullable: true, example: 'domains' }) sector!: string | null;
  @ApiProperty({
    enum: ['too_small', 'unknown_sector'],
    example: 'too_small',
    description:
      'too_small — участников меньше minSectorSize; unknown_sector — сектор не определён',
  })
  reason!: string;
  @ApiProperty({ example: 1 }) size!: number;
  @ApiProperty({ type: SectorMemberDto, isArray: true }) members!: SectorMemberDto[];
  @ApiProperty({ example: 'Участников 1 при пороге сравнения 3' }) note!: string;
}

export class ManualDataCandidateDto extends SectorMemberDto {
  @ApiProperty({ nullable: true, example: null }) sector!: string | null;
  @ApiProperty({ nullable: true, example: 900_000_000 }) mcapCalcUsd!: number | null;
  @ApiProperty({ nullable: true, example: 12_400_000 }) vol24hUsd!: number | null;
  @ApiProperty({ enum: ['gecko_id', 'symbol', 'chain', 'override', 'none'] })
  matchedBy!: string;
  @ApiProperty({ type: [String], example: [] }) defillamaSlugs!: string[];
  @ApiProperty({
    example: 'Протокол DeFiLlama не найден ни по gecko_id, ни по тикеру группы',
    description: 'Чего не хватает, чтобы система могла что-то сказать',
  })
  reason!: string;
}

export class AlphaTotalsDto {
  @ApiProperty({ example: 607, description: 'Прошло отбор профиля' }) passed!: number;
  @ApiProperty({ example: 168, description: 'Участвуют в перцентилях: тиры с числами' })
  ranked!: number;
  @ApiProperty({ example: 41 }) sectors!: number;
  @ApiProperty({ example: 18, description: 'Секторов не меньше minSectorSize' })
  sectorsRanked!: number;
  @ApiProperty({ example: 23 }) sectorsWithoutComparison!: number;
  @ApiProperty({ example: 3, description: 'Участники есть, qualify не прошёл никто' })
  sectorsWithoutLeaders!: number;
  @ApiProperty({ example: 74 }) leaders!: number;
  @ApiProperty({ example: 218, description: 'Полное число до применения limit' })
  needsManualData!: number;
}

export class UniverseAlphaResponseDto {
  @ApiProperty({ example: '2026-08-25' }) universeVersion!: string;
  @ApiProperty({ example: '2026-08-25T06:00:00.000Z' }) builtAt!: string;
  @ApiProperty({ example: 'default' }) profileId!: string;
  @ApiProperty({
    type: AlphaConfigDto,
    description: 'Чем считали: без параметров альфы выдача непроверяема',
  })
  alpha!: AlphaConfigDto;
  @ApiProperty({ type: AlphaTotalsDto }) totals!: AlphaTotalsDto;
  @ApiProperty({ type: SectorLeaderDto, isArray: true }) leaders!: SectorLeaderDto[];
  @ApiProperty({ type: SectorWithoutComparisonDto, isArray: true })
  sectorsWithoutComparison!: SectorWithoutComparisonDto[];
  @ApiProperty({ type: ManualDataCandidateDto, isArray: true })
  needsManualData!: ManualDataCandidateDto[];
  @ApiProperty({
    type: [String],
    example: ['Секторов без лидеров: 3. Участники есть, порог qualify не прошёл никто: domains'],
  })
  warnings!: string[];
}