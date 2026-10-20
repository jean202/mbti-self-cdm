import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class StartMbtiFinderAttemptDto {
  @ApiPropertyOptional({ description: 'Version of the question set to use', example: 'v1.0', maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, {
    message: 'question_set_version must be a plain version name.',
  })
  question_set_version?: string;
}
