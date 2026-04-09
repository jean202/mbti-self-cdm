import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StartMbtiFinderAttemptDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  question_set_version?: string;
}
