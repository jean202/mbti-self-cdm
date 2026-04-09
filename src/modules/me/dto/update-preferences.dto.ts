import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class QuietHoursDto {
  @ApiProperty({ description: 'Quiet hours start time (HH:MM)', example: '22:00' })
  @Matches(/^\d{2}:\d{2}$/)
  start!: string;

  @ApiProperty({ description: 'Quiet hours end time (HH:MM)', example: '08:00' })
  @Matches(/^\d{2}:\d{2}$/)
  end!: string;
}

export class NotificationPrefsDto {
  @ApiPropertyOptional({ description: 'Whether notifications are enabled', example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Quiet hours configuration', type: () => QuietHoursDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuietHoursDto)
  quiet_hours?: QuietHoursDto;
}

export class UpdatePreferencesDto {
  @ApiPropertyOptional({ description: 'Notification preferences', type: () => NotificationPrefsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationPrefsDto)
  notification_prefs?: NotificationPrefsDto;

  @ApiPropertyOptional({ description: 'User locale code', example: 'ko-KR', maxLength: 16 })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @ApiPropertyOptional({ description: 'User timezone', example: 'Asia/Seoul', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
