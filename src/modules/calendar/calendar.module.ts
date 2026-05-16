import { Module } from '@nestjs/common';

import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarSyncWorker } from './calendar-sync.worker';
import { InternalCalendarOAuthController } from './internal-calendar-oauth.controller';
import { OnboardingCalendarController } from './onboarding-calendar.controller';
import { GoogleCalendarAdapter } from './adapters/google-calendar.adapter';
import { SecretsModule } from '../../common/secrets/secrets.module';

@Module({
  imports: [SecretsModule],
  controllers: [
    CalendarController,
    OnboardingCalendarController,
    InternalCalendarOAuthController,
  ],
  providers: [CalendarService, CalendarSyncWorker, GoogleCalendarAdapter],
})
export class CalendarModule {}
