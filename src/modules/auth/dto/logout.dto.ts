import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LogoutDto {
  @ApiPropertyOptional({ description: 'Refresh token to invalidate', example: 'eyJhbGciOiJIUzI1NiIs...' })
  @IsOptional()
  @IsString()
  refresh_token?: string;

  @ApiProperty({ description: 'Whether to log out from all devices', example: false })
  @IsBoolean()
  logout_all_devices = false;
}
