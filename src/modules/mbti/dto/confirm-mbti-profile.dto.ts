import { MbtiSource } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsIn, Matches } from 'class-validator';

const CONFIRMABLE_SOURCES = [
  MbtiSource.SELF_SELECTED,
  MbtiSource.FINDER_RESULT,
] as const;

export class ConfirmMbtiProfileDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @Matches(/^[EI][SN][TF][JP]$/)
  type_code!: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsIn(CONFIRMABLE_SOURCES)
  source!: (typeof CONFIRMABLE_SOURCES)[number];
}
