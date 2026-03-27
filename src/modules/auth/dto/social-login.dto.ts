import { AuthProvider } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class ProviderPayloadDto {
  @IsOptional()
  @IsString()
  authorization_code?: string;

  @IsOptional()
  @IsString()
  id_token?: string;

  @IsOptional()
  @IsString()
  nonce?: string;

  @IsOptional()
  @IsString()
  provider_user_id?: string;

  @IsOptional()
  @IsString()
  provider_email?: string;
}

class DeviceDto {
  @IsString()
  device_id!: string;

  @IsString()
  platform!: string;

  @IsString()
  app_version!: string;
}

export class SocialLoginDto {
  @IsEnum(AuthProvider)
  provider!: AuthProvider;

  @ValidateNested()
  @Type(() => ProviderPayloadDto)
  provider_payload!: ProviderPayloadDto;

  @ValidateNested()
  @Type(() => DeviceDto)
  device!: DeviceDto;
}
