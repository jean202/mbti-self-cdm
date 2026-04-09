import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({ description: 'JWT refresh token', example: 'eyJhbGciOiJIUzI1NiIs...' })
  @IsString()
  refresh_token!: string;

  @ApiProperty({ description: 'Session identifier', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  session_id!: string;

  @ApiPropertyOptional({ description: 'Device identifier for session binding', example: 'device-uuid-1234' })
  @IsOptional()
  @IsString()
  device_id?: string;
}
