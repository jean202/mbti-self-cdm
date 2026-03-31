import { IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpsertReflectionDto {
  @IsOptional()
  @IsUUID()
  today_focus_id?: string;

  @IsOptional()
  @IsUUID()
  mood_energy_check_id?: string;

  @IsOptional()
  @IsUUID()
  mindfulness_prompt_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  completed_summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  carry_forward_note?: string;

  @IsOptional()
  @IsObject()
  prompt_answers?: Record<string, string>;
}
