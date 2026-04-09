import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';

export class SelfSelectMbtiProfileDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @Matches(/^[EI][SN][TF][JP]$/)
  type_code!: string;
}
