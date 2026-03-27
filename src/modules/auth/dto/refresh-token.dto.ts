import { IsOptional, IsString, IsUUID } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  refresh_token!: string;

  @IsUUID()
  session_id!: string;

  @IsOptional()
  @IsString()
  device_id?: string;
}
