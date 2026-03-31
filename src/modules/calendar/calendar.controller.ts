import { Controller, Get, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user.type';
import { CalendarService } from './calendar.service';

@Controller('calendar')
@UseGuards(AuthGuard)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get('connections')
  getConnections(@CurrentUser() currentUser: RequestUser) {
    return this.calendarService.getConnections(currentUser.userId);
  }
}
