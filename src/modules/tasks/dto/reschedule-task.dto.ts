import { IsDateString, IsOptional, Matches } from 'class-validator';

export class RescheduleTaskDto {
  @IsOptional()
  @IsDateString()
  due_at?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  local_due_date?: string | null;
}
