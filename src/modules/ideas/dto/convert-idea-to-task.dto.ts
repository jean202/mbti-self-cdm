import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class ConvertIdeaToTaskDto {
  @IsOptional()
  @IsUUID()
  today_focus_id?: string;

  @IsOptional()
  @IsDateString()
  due_at?: string;
}
