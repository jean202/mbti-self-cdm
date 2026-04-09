import { TaskSourceType } from '@prisma/client';
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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTaskDto {
  @ApiProperty({ description: 'Task title', example: 'Buy groceries', minLength: 1, maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ description: 'Additional notes for the task', example: 'Remember to buy milk and eggs', maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;

  @ApiProperty({ description: 'How the task was created', enum: TaskSourceType, example: 'MANUAL' })
  @IsEnum(TaskSourceType)
  source_type!: TaskSourceType;

  @ApiPropertyOptional({ description: 'Associated today focus ID', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsUUID()
  today_focus_id?: string;

  @ApiPropertyOptional({ description: 'Due date in ISO 8601 format', example: '2026-04-10T09:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  due_at?: string;

  @ApiPropertyOptional({ description: 'Reminder date in ISO 8601 format', example: '2026-04-10T08:30:00.000Z' })
  @IsOptional()
  @IsDateString()
  reminder_at?: string;

  @ApiPropertyOptional({ description: 'Estimated energy level required (1-5)', example: 3 })
  @IsOptional()
  @IsInt()
  energy_estimate?: number;

  @ApiPropertyOptional({ description: 'Sort order for manual ordering', example: 1 })
  @IsOptional()
  @IsInt()
  sort_order?: number;
}
