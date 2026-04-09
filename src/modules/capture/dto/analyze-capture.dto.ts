import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AnalyzeCaptureDto {
  @ApiProperty({ description: 'Raw text input to analyze and capture', example: 'Buy milk tomorrow morning', minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  input_text!: string;

  @ApiPropertyOptional({ description: 'Local date for context (YYYY-MM-DD)', example: '2026-04-09' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  local_date?: string;
}
