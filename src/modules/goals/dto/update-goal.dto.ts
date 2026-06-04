import { GoalHorizon, GoalStatus } from '@prisma/client';
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
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateGoalDto {
  @ApiPropertyOptional({ description: 'Goal title', example: '포트폴리오 3개 완성' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ description: 'Goal note', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string | null;

  @ApiPropertyOptional({ description: 'Goal horizon', enum: GoalHorizon })
  @IsOptional()
  @IsEnum(GoalHorizon)
  horizon?: GoalHorizon;

  @ApiPropertyOptional({ description: 'Goal status', enum: GoalStatus })
  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;

  @ApiPropertyOptional({ description: 'Target numeric value', example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(9999999999)
  target_value?: number;

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

  @ApiPropertyOptional({ description: 'Target date in YYYY-MM-DD', nullable: true })
  @IsOptional()
  @IsDateString()
  target_date?: string | null;
}
