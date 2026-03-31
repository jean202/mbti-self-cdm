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

export class QuietHoursDto {
  @Matches(/^\d{2}:\d{2}$/)
  start!: string;

  @Matches(/^\d{2}:\d{2}$/)
  end!: string;
}

export class NotificationPrefsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => QuietHoursDto)
  quiet_hours?: QuietHoursDto;
}

export class UpdatePreferencesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationPrefsDto)
  notification_prefs?: NotificationPrefsDto;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
