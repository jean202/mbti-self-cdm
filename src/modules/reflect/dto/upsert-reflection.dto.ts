import { IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertReflectionDto {
  @ApiPropertyOptional({ description: 'Associated today focus ID', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsUUID()
  today_focus_id?: string;

  @ApiPropertyOptional({ description: 'Associated mood-energy check ID', example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  @IsOptional()
  @IsUUID()
  mood_energy_check_id?: string;

  @ApiPropertyOptional({ description: 'Associated mindfulness prompt ID', example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' })
  @IsOptional()
  @IsUUID()
  mindfulness_prompt_id?: string;

  @ApiPropertyOptional({ description: 'Summary of what was completed today', example: 'Finished the landing page and wrote tests', maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  completed_summary?: string;

  @ApiPropertyOptional({ description: 'Notes on tasks to carry forward', example: 'Need to review PR tomorrow', maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  carry_forward_note?: string;

  @ApiPropertyOptional({ description: 'Answers to mindfulness prompts keyed by prompt ID', example: { 'q1': 'I felt productive', 'q2': 'Grateful for team support' } })
  @IsOptional()
  @IsObject()
  prompt_answers?: Record<string, string>;
}
