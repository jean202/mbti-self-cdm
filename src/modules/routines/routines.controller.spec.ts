import { type ExecutionContext, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { AuthGuard } from '../../common/auth/auth.guard';
import { RoutinesController } from './routines.controller';
import { RoutinesService } from './routines.service';

describe('RoutinesController recommendation-window HTTP contract', () => {
  const routineId = '4cbb9435-c649-4fae-8bb5-487e70393f27';
  const url = `/v1/routines/${routineId}/recommendation-window`;
  const service = { updateRecommendationWindow: jest.fn() };
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [RoutinesController],
      providers: [{ provide: RoutinesService, useValue: service }],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest().user = { userId: 'user-1', sessionId: 'session-1' };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => app.close());

  it.each([
    { mode: 'CLOCK', startMinutes: 0, endMinutes: 1439 },
    { mode: 'CLOCK', startMinutes: 1439, endMinutes: 0 },
    { mode: 'AFTER_WAKE', durationMinutes: 1 },
    { mode: 'AFTER_WAKE', durationMinutes: 1440 },
    { mode: 'BEFORE_SLEEP', durationMinutes: 1 },
    { mode: 'BEFORE_SLEEP', durationMinutes: 1440 },
    { mode: 'ANYTIME' },
    null,
  ])('accepts valid PATCH including explicit null and uses the authenticated user: %j', async (window) => {
    service.updateRecommendationWindow.mockResolvedValue({ id: routineId, cadencePayloadJson: { timesPerWeek: 3 } });
    const response = await app.inject({ method: 'PATCH', url, payload: { recommendationWindow: window } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: routineId, cadencePayloadJson: { timesPerWeek: 3 } });
    expect(service.updateRecommendationWindow).toHaveBeenCalledWith('user-1', routineId, { recommendationWindow: window });
  });

  it.each([
    {},
    { unrelated: null },
    { recommendationWindow: 'ANYTIME' },
    { recommendationWindow: [] },
    { recommendationWindow: {} },
    { recommendationWindow: { mode: 'UNKNOWN' } },
    { recommendationWindow: { mode: 'CLOCK', startMinutes: 0 } },
    { recommendationWindow: { mode: 'CLOCK', startMinutes: 60, endMinutes: 60 } },
    { recommendationWindow: { mode: 'CLOCK', startMinutes: '0', endMinutes: 60 } },
    { recommendationWindow: { mode: 'CLOCK', startMinutes: 0, endMinutes: 1440 } },
    { recommendationWindow: { mode: 'CLOCK', startMinutes: 0, endMinutes: 60, durationMinutes: 1 } },
    { recommendationWindow: { mode: 'AFTER_WAKE' } },
    { recommendationWindow: { mode: 'AFTER_WAKE', durationMinutes: 0 } },
    { recommendationWindow: { mode: 'AFTER_WAKE', durationMinutes: 1441 } },
    { recommendationWindow: { mode: 'BEFORE_SLEEP', durationMinutes: 1.5 } },
    { recommendationWindow: { mode: 'BEFORE_SLEEP', durationMinutes: '60' } },
    { recommendationWindow: { mode: 'ANYTIME', durationMinutes: 1 } },
    { recommendationWindow: { mode: 'ANYTIME', extra: true } },
  ])('rejects malformed PATCH before invoking the service: %j', async (payload) => {
    const response = await app.inject({ method: 'PATCH', url, payload });
    expect(response.statusCode).toBe(400);
    expect(service.updateRecommendationWindow).not.toHaveBeenCalled();
  });

  it('rejects a malformed routine UUID before invoking the service', async () => {
    const response = await app.inject({
      method: 'PATCH', url: '/v1/routines/not-a-uuid/recommendation-window',
      payload: { recommendationWindow: null },
    });
    expect(response.statusCode).toBe(400);
    expect(service.updateRecommendationWindow).not.toHaveBeenCalled();
  });
});
