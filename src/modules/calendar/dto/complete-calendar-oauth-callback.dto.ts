import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CompleteCalendarOAuthCallbackDto {
  @ApiProperty({ description: 'OAuth state parameter for CSRF verification', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  state!: string;

  @ApiPropertyOptional({ description: 'Authorization code from the OAuth provider', example: '4/0AX4XfWh...', maxLength: 4096 })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  code?: string;

  @ApiPropertyOptional({ description: 'Error code if OAuth flow failed', example: 'access_denied', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  error?: string;

  @ApiPropertyOptional({ description: 'Human-readable error description', example: 'The user denied the authorization request', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  error_description?: string;

  @ApiPropertyOptional({ description: 'Provider-specific account identifier', example: 'user@gmail.com', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  provider_account_id?: string;

  @ApiPropertyOptional({ description: 'Display label for the connected account', example: 'Work Calendar', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  account_label?: string;
}
