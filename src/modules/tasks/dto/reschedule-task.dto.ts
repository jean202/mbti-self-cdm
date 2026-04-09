import { IsDateString, IsOptional, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RescheduleTaskDto {
  @ApiPropertyOptional({ description: 'New due date in ISO 8601 format', example: '2026-04-15T09:00:00.000Z', nullable: true })
  @IsOptional()
  @IsDateString()
  due_at?: string | null;

  @ApiPropertyOptional({ description: 'New local due date (YYYY-MM-DD)', example: '2026-04-15', nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  local_due_date?: string | null;
}
