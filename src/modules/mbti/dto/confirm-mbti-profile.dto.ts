import { MbtiSource } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsIn, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const CONFIRMABLE_SOURCES = [
  MbtiSource.SELF_SELECTED,
  MbtiSource.FINDER_RESULT,
] as const;

export class ConfirmMbtiProfileDto {
  @ApiProperty({ description: 'MBTI type code (4 letters)', example: 'ENFJ' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @Matches(/^[EI][SN][TF][JP]$/)
  type_code!: string;

  @ApiProperty({ description: 'Source of the MBTI profile', enum: ['SELF_SELECTED', 'FINDER_RESULT'], example: 'SELF_SELECTED' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsIn(CONFIRMABLE_SOURCES)
  source!: (typeof CONFIRMABLE_SOURCES)[number];
}
