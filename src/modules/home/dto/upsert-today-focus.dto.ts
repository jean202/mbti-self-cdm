import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertTodayFocusDto {
  @ApiProperty({ description: 'Local date for the focus (YYYY-MM-DD)', example: '2026-04-09' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  local_date!: string;

  @ApiProperty({ description: 'Focus title for the day', example: 'Ship the landing page', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ description: 'Additional notes for the focus', example: 'Include hero section and CTA', maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;

  @ApiPropertyOptional({ description: 'Linked task ID', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsUUID()
  linked_task_id?: string;
}
