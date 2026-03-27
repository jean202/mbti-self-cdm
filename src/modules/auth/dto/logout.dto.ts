import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class LogoutDto {
  @IsOptional()
  @IsString()
  refresh_token?: string;

  @IsBoolean()
  logout_all_devices = false;
}
