import { Test, type TestingModule } from '@nestjs/testing';

import { OnboardingCalendarController } from './onboarding-calendar.controller';
import { CalendarService } from './calendar.service';
import type { RequestUser } from '../../common/types/request-user.type';
import { AuthGuard } from '../../common/auth/auth.guard';

describe('OnboardingCalendarController', () => {
  let controller: OnboardingCalendarController;
  let service: jest.Mocked<CalendarService>;

  const mockUser: RequestUser = {
    userId: 'user-123',
    sessionId: 'session-123',
  };

  beforeEach(async () => {
    const mockCalendarService = {
      skipCalendarOnboarding: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OnboardingCalendarController],
      providers: [
        {
          provide: CalendarService,
          useValue: mockCalendarService,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<OnboardingCalendarController>(OnboardingCalendarController);
    service = module.get(CalendarService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('skip', () => {
    it('should call CalendarService.skipCalendarOnboarding', async () => {
      const expectedResult = { onboarding: { status: 'COMPLETED' } };
      service.skipCalendarOnboarding.mockResolvedValue(expectedResult as any);

      const result = await controller.skip(mockUser);

      expect(service.skipCalendarOnboarding).toHaveBeenCalledWith(mockUser.userId);
      expect(result).toEqual(expectedResult);
    });
  });
});