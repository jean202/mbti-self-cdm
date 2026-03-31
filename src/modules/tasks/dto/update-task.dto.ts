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

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string | null;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsUUID()
  today_focus_id?: string | null;

  @IsOptional()
  @IsDateString()
  due_at?: string | null;

  @IsOptional()
  @IsDateString()
  reminder_at?: string | null;

  @IsOptional()
  @IsInt()
  energy_estimate?: number | null;

  @IsOptional()
  @IsInt()
  sort_order?: number | null;
}
