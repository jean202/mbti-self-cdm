import { IsOptional, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PlanTodayQueryDto {
  @ApiPropertyOptional({ description: 'Local date to query (YYYY-MM-DD)', example: '2026-04-09' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  local_date?: string;
}
