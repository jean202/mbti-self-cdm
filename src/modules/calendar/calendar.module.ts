import { Module } from '@nestjs/common';

import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { InternalCalendarOAuthController } from './internal-calendar-oauth.controller';
import { OnboardingCalendarController } from './onboarding-calendar.controller';

@Module({
  controllers: [
    CalendarController,
    OnboardingCalendarController,
    InternalCalendarOAuthController,
  ],
  providers: [CalendarService],
})
export class CalendarModule {}
