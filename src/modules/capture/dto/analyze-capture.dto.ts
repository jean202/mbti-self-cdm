import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class AnalyzeCaptureDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  input_text!: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  local_date?: string;
}
