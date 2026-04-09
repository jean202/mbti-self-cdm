import { CalendarProvider } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class StartCalendarOAuthDto {
  @ApiProperty({ description: 'Calendar provider to connect', enum: CalendarProvider, example: 'GOOGLE' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsEnum(CalendarProvider)
  provider!: CalendarProvider;

  @ApiProperty({ description: 'OAuth redirect URI', example: 'myapp://oauth/callback' })
  @Matches(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/.+$/)
  redirect_uri!: string;
}
