import { AuthProvider } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class ProviderPayloadDto {
  @ApiPropertyOptional({ description: 'OAuth authorization code from the provider', example: '4/0AX4XfWh...' })
  @IsOptional()
  @IsString()
  authorization_code?: string;

  @ApiPropertyOptional({ description: 'OIDC id_token from the provider', example: 'eyJhbGciOiJSUzI1NiIs...' })
  @IsOptional()
  @IsString()
  id_token?: string;

  @ApiPropertyOptional({ description: 'Nonce used for OIDC verification', example: 'abc123xyz' })
  @IsOptional()
  @IsString()
  nonce?: string;

  @ApiPropertyOptional({ description: 'User ID from the OAuth provider', example: '109876543210' })
  @IsOptional()
  @IsString()
  provider_user_id?: string;

  @ApiPropertyOptional({ description: 'Email from the OAuth provider', example: 'user@example.com' })
  @IsOptional()
  @IsString()
  provider_email?: string;
}

class DeviceDto {
  @ApiProperty({ description: 'Unique device identifier', example: 'device-uuid-1234' })
  @IsString()
  device_id!: string;

  @ApiProperty({ description: 'Device platform', example: 'ios' })
  @IsString()
  platform!: string;

  @ApiProperty({ description: 'Application version', example: '1.0.0' })
  @IsString()
  app_version!: string;
}

export class SocialLoginDto {
  @ApiProperty({ description: 'OAuth provider type', enum: AuthProvider, example: 'GOOGLE' })
  @IsEnum(AuthProvider)
  provider!: AuthProvider;

  @ApiProperty({ description: 'Provider-specific authentication payload', type: () => ProviderPayloadDto })
  @ValidateNested()
  @Type(() => ProviderPayloadDto)
  provider_payload!: ProviderPayloadDto;

  @ApiProperty({ description: 'Device information', type: () => DeviceDto })
  @ValidateNested()
  @Type(() => DeviceDto)
  device!: DeviceDto;
}
