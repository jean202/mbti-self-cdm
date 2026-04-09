import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CompleteCalendarOAuthCallbackDto {
  @IsUUID()
  state!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  error?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  error_description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  provider_account_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  account_label?: string;
}
