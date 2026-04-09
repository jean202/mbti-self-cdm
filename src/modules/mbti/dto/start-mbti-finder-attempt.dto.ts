import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class StartMbtiFinderAttemptDto {
  @ApiPropertyOptional({ description: 'Version of the question set to use', example: 'v1.0', maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  question_set_version?: string;
}
