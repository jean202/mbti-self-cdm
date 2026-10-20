import { CalendarProvider } from '@prisma/client';
import type { FastifyReply } from 'fastify';

import type { CalendarService } from './calendar.service';
import { InternalCalendarOAuthController } from './internal-calendar-oauth.controller';

describe('InternalCalendarOAuthController', () => {
  it('redirects the browser back to the app with an explicit 302', async () => {
    const calendarService = {
      completeOAuthConnection: jest.fn().mockResolvedValue({
        success: true,
        provider: CalendarProvider.GOOGLE,
        redirect_to: 'mbtiapp://calendar?calendar_oauth_status=success',
      }),
    };
    const reply = { redirect: jest.fn().mockReturnThis() };
    const controller = new InternalCalendarOAuthController(
      calendarService as unknown as CalendarService,
    );

    await controller.completeOAuthConnection(
      'google',
      { state: 'flow-1', code: 'code-1' },
      reply as unknown as FastifyReply,
    );

    expect(calendarService.completeOAuthConnection).toHaveBeenCalledWith('google', {
      state: 'flow-1',
      code: 'code-1',
    });
    // 코드를 생략하면 Nest가 먼저 설정한 200이 유지된다(e2e calendar 스펙 참고).
    expect(reply.redirect).toHaveBeenCalledWith(
      'mbtiapp://calendar?calendar_oauth_status=success',
      302,
    );
  });
});
