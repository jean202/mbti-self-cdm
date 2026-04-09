import { TaskStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateTaskDto {
  @ApiPropertyOptional({ description: 'Updated task title', example: 'Buy groceries and snacks', minLength: 1, maxLength: 255 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ description: 'Updated notes for the task', example: 'Add fruits to the list', nullable: true, maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string | null;

  @ApiPropertyOptional({ description: 'Updated task status', enum: TaskStatus, example: 'DONE' })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional({ description: 'Associated today focus ID', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', nullable: true })
  @IsOptional()
  @IsUUID()
  today_focus_id?: string | null;

  @ApiPropertyOptional({ description: 'Due date in ISO 8601 format', example: '2026-04-10T09:00:00.000Z', nullable: true })
  @IsOptional()
  @IsDateString()
  due_at?: string | null;

  @ApiPropertyOptional({ description: 'Reminder date in ISO 8601 format', example: '2026-04-10T08:30:00.000Z', nullable: true })
  @IsOptional()
  @IsDateString()
  reminder_at?: string | null;

  @ApiPropertyOptional({ description: 'Estimated energy level required (1-5)', example: 3, nullable: true })
  @IsOptional()
  @IsInt()
  energy_estimate?: number | null;

  @ApiPropertyOptional({ description: 'Sort order for manual ordering', example: 2, nullable: true })
  @IsOptional()
  @IsInt()
  sort_order?: number | null;
}
