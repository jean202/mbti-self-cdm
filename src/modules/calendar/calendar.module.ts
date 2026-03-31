import { Module } from '@nestjs/common';

import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { OnboardingCalendarController } from './onboarding-calendar.controller';

@Module({
  controllers: [CalendarController, OnboardingCalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
