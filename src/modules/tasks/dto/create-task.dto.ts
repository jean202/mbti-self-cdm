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

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;

  @IsEnum(TaskSourceType)
  source_type!: TaskSourceType;

  @IsOptional()
  @IsUUID()
  today_focus_id?: string;

  @IsOptional()
  @IsDateString()
  due_at?: string;

  @IsOptional()
  @IsDateString()
  reminder_at?: string;

  @IsOptional()
  @IsInt()
  energy_estimate?: number;

  @IsOptional()
  @IsInt()
  sort_order?: number;
}
