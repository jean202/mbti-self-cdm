import { CheckContext } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateMoodEnergyCheckDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  local_date!: string;

  @IsEnum(CheckContext)
  context!: CheckContext;

  @IsInt()
  @Min(1)
  @Max(5)
  mood_score!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  energy_score!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
