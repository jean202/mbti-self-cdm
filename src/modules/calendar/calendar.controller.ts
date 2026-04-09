import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user.type';
import { ListCalendarEventsQueryDto } from './dto/list-calendar-events-query.dto';
import { StartCalendarOAuthDto } from './dto/start-calendar-oauth.dto';
import { CalendarService } from './calendar.service';

@ApiTags('Calendar')
@ApiBearerAuth()
@Controller('calendar')
@UseGuards(AuthGuard)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Post('connections/oauth/start')
  startOAuthConnection(
    @CurrentUser() currentUser: RequestUser,
    @Body() body: StartCalendarOAuthDto,
  ) {
    return this.calendarService.startOAuthConnection(currentUser.userId, body);
  }

  @Get('connections')
  getConnections(@CurrentUser() currentUser: RequestUser) {
    return this.calendarService.getConnections(currentUser.userId);
  }

  @Post('connections/:connection_id/sync')
  syncConnection(
    @CurrentUser() currentUser: RequestUser,
    @Param('connection_id') connectionId: string,
  ) {
    return this.calendarService.syncConnection(currentUser.userId, connectionId);
  }

  @Post('connections/:connection_id/revoke')
  revokeConnection(
    @CurrentUser() currentUser: RequestUser,
    @Param('connection_id') connectionId: string,
  ) {
    return this.calendarService.revokeConnection(currentUser.userId, connectionId);
  }

  @Get('events')
  listEvents(
    @CurrentUser() currentUser: RequestUser,
    @Query() query: ListCalendarEventsQueryDto,
  ) {
    return this.calendarService.listEvents(currentUser.userId, query);
  }
}
