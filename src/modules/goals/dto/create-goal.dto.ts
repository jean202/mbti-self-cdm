import { GoalHorizon } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGoalDto {
  @ApiProperty({ description: 'Goal title', example: '포트폴리오 3개 완성' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ description: 'Goal note', example: '웹, 모바일, 데이터 프로젝트 각 1개' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;

  @ApiProperty({ description: 'Goal horizon', enum: GoalHorizon, example: 'MID_TERM' })
  @IsEnum(GoalHorizon)
  horizon!: GoalHorizon;

  @ApiProperty({ description: 'Target numeric value', example: 3 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(9999999999)
  target_value!: number;

  @ApiPropertyOptional({ description: 'Current numeric value', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(9999999999)
  current_value?: number;

  @ApiPropertyOptional({ description: 'Goal unit', example: '개' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  unit?: string;

  @ApiPropertyOptional({ description: 'Start date in YYYY-MM-DD', example: '2026-06-04' })
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @ApiPropertyOptional({ description: 'Target date in YYYY-MM-DD', example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  target_date?: string;
}
