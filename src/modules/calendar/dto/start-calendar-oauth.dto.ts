import { CalendarProvider } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, Matches } from 'class-validator';

export class StartCalendarOAuthDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsEnum(CalendarProvider)
  provider!: CalendarProvider;

  @Matches(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/.+$/)
  redirect_uri!: string;
}
