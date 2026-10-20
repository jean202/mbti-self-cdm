import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Query,
  Res,
} from '@nestjs/common';
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

    // Nest가 핸들러 전에 200을 먼저 설정하므로 코드를 명시하지 않으면 Location만 붙은 200이 나간다.
    return reply.redirect(result.redirect_to, HttpStatus.FOUND);
  }
}
