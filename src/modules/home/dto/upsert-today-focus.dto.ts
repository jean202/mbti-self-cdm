import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class UpsertTodayFocusDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  local_date!: string;

  @IsString()
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;

  @IsOptional()
  @IsUUID()
  linked_task_id?: string;
}
