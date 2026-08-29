import { ApiProperty } from '@nestjs/swagger';
import { ResponseContextDto } from '../../core/envelope.dto';
import { CandidateEvaluationDto } from './evaluation.dto';

export class TokenIdentityDto {
  @ApiProperty({ example: 'aave' }) coingeckoId!: string;
  @ApiProperty({ example: 'AAVE' }) ticker!: string;
  @ApiProperty({ example: 'Aave' }) name!: string;
  @ApiProperty({ example: 12 }) rank!: number;
  @ApiProperty({ nullable: true, example: 'lending' }) sector!: string | null;
  @ApiProperty({ nullable: true, example: 'lending' }) comparisonGroup!: string | null;
  @ApiProperty({ example: 'protocol' }) assetArchetype!: string;
  @ApiProperty({ example: 'gecko_id' }) matchedBy!: string;
}

export class ScreenPresenceDto {
  @ApiProperty({ example: true }) enabled!: boolean;
  @ApiProperty({ example: true }) passed!: boolean;
  @ApiProperty({ nullable: true, example: null }) stage!: string | null;
  @ApiProperty({ nullable: true, example: null }) reason!: string | null;
}

export class AlphaPresenceDto {
  @ApiProperty({ example: true }) enabled!: boolean;
  @ApiProperty({
    example: true,
    description:
      'Видела ли альфа эту строку. false при enabled: true означает, что её снял ' +
      'screen раньше, а не что сравнение ничего не дало',
  })
  applied!: boolean;
  @ApiProperty({ nullable: true, example: 'kept_top_n' }) decision!: string | null;
  @ApiProperty({ nullable: true, example: 'Место 2 из 9 сравнимых в секторе lending' })
  reason!: string | null;
  @ApiProperty({ nullable: true, example: 2 }) rankInSector!: number | null;
  @ApiProperty({ nullable: true, example: 9 }) sectorSize!: number | null;
}

export class TokenPresenceDto {
  @ApiProperty({ example: true }) inSnapshot!: boolean;
  @ApiProperty({
    nullable: true,
    example: null,
    description: 'Заполнено, только когда токена в снимке нет',
  })
  absenceReason!: string | null;
  @ApiProperty({ type: ScreenPresenceDto }) screen!: ScreenPresenceDto;
  @ApiProperty({ type: AlphaPresenceDto }) alpha!: AlphaPresenceDto;
  @ApiProperty({ example: true }) inActiveSelection!: boolean;
}

export class TokenFactGroupDto {
  @ApiProperty({ nullable: true, example: 'https://defillama.com/protocol/aave-v3' })
  sourceUrl!: string | null;
  @ApiProperty({
    nullable: true,
    example: '2026-08-29T06:00:00.000Z',
    description: 'У выручки и TVL своей даты нет: едет marketAsOf того же прогона чисел',
  })
  asOf!: string | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { revenue12mUsd: 112_000_000, pRev: 33.5, holderYieldPct: 1.6 },
  })
  values!: Record<string, number | string | null>;
}

export class TokenFactsDto {
  @ApiProperty({ type: TokenFactGroupDto }) market!: TokenFactGroupDto;
  @ApiProperty({ type: TokenFactGroupDto }) revenue!: TokenFactGroupDto;
  @ApiProperty({ type: TokenFactGroupDto }) tokenomics!: TokenFactGroupDto;
}

export class TokenDataStatesDto {
  @ApiProperty({ nullable: true, example: 'available' }) revenue!: string | null;
  @ApiProperty({ nullable: true, example: 'source_missing' }) tokenomics!: string | null;
  @ApiProperty({ nullable: true, example: 'available' }) comparisonGroup!: string | null;
}

export class TokenReportDto {
  @ApiProperty({ type: ResponseContextDto }) context!: ResponseContextDto;
  @ApiProperty({ type: TokenIdentityDto, nullable: true }) identity!: TokenIdentityDto | null;
  @ApiProperty({ type: TokenPresenceDto }) presence!: TokenPresenceDto;
  @ApiProperty({ type: TokenFactsDto, nullable: true }) facts!: TokenFactsDto | null;
  @ApiProperty({ type: TokenDataStatesDto }) dataStates!: TokenDataStatesDto;
  @ApiProperty({ enum: ['evaluated', 'not_in_selection', 'no_run'], example: 'evaluated' })
  evaluationStatus!: string;
  @ApiProperty({ type: CandidateEvaluationDto, nullable: true })
  evaluation!: CandidateEvaluationDto | null;
  @ApiProperty({
    type: [String],
    example: ['Разлоки не покрыты источником: POST /manual/unlocks со ссылкой и датой вернёт NHY'],
  })
  whatWouldChangeThis!: string[];
}