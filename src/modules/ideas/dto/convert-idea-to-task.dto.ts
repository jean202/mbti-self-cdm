import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ConvertIdeaToTaskDto {
  @ApiPropertyOptional({ description: 'Today focus ID to associate the new task with', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsUUID()
  today_focus_id?: string;

  @ApiPropertyOptional({ description: 'Due date for the new task in ISO 8601 format', example: '2026-04-10T09:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  due_at?: string;
}
