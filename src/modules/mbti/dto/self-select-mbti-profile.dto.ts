import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SelfSelectMbtiProfileDto {
  @ApiProperty({ description: 'MBTI type code (4 letters)', example: 'INFP' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @Matches(/^[EI][SN][TF][JP]$/)
  type_code!: string;
}
