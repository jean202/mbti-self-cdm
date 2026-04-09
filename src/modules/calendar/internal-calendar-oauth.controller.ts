import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { CompleteCalendarOAuthCallbackDto } from './dto/complete-calendar-oauth-callback.dto';
import { CalendarService } from './calendar.service';

@Controller('internal/calendar/oauth')
export class InternalCalendarOAuthController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get(':provider/callback')
  async completeOAuthConnection(
    @Param('provider') provider: string,
    @Query() query: CompleteCalendarOAuthCallbackDto,
    @Res() reply: FastifyReply,
  ) {
    const result = await this.calendarService.completeOAuthConnection(
      provider,
      query,
    );

    return reply.redirect(result.redirect_to);
  }
}
