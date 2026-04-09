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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMoodEnergyCheckDto {
  @ApiProperty({ description: 'Local date for the check (YYYY-MM-DD)', example: '2026-04-09' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  local_date!: string;

  @ApiProperty({ description: 'Context of the check (e.g. morning, evening)', enum: CheckContext, example: 'MORNING' })
  @IsEnum(CheckContext)
  context!: CheckContext;

  @ApiProperty({ description: 'Mood score from 1 (low) to 5 (high)', example: 4, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  mood_score!: number;

  @ApiProperty({ description: 'Energy score from 1 (low) to 5 (high)', example: 3, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  energy_score!: number;

  @ApiPropertyOptional({ description: 'Optional note about mood/energy', example: 'Feeling well-rested today', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
