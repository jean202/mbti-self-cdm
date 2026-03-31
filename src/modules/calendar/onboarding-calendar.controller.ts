import { Controller, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user.type';
import { CalendarService } from './calendar.service';

@Controller('onboarding/calendar')
@UseGuards(AuthGuard)
export class OnboardingCalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Post('skip')
  skip(@CurrentUser() currentUser: RequestUser) {
    return this.calendarService.skipCalendarOnboarding(currentUser.userId);
  }
}
