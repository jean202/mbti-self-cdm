import { Test, type TestingModule } from '@nestjs/testing';
import { CalendarProvider, CalendarConnectionStatus } from '@prisma/client';

import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import type { RequestUser } from '../../common/types/request-user.type';
import { AuthGuard } from '../../common/auth/auth.guard';

describe('CalendarController', () => {
  let controller: CalendarController;
  let service: jest.Mocked<CalendarService>;

  const mockUser: RequestUser = {
    userId: 'user-123',
    sessionId: 'session-123',
  };

  beforeEach(async () => {
    const mockCalendarService = {
      startOAuthConnection: jest.fn(),
      getConnections: jest.fn(),
      syncConnection: jest.fn(),
      revokeConnection: jest.fn(),
      listEvents: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CalendarController],
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

    controller = module.get<CalendarController>(CalendarController);
    service = module.get(CalendarService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('startOAuthConnection', () => {
    it('should call CalendarService.startOAuthConnection with correct parameters', async () => {
      const dto = { provider: CalendarProvider.GOOGLE, redirect_uri: 'http://localhost/callback' };
      const expectedResult = {
        provider: CalendarProvider.GOOGLE,
        flow_id: '12345678-1234-1234-1234-123456789012',
        authorize_url: 'http://auth.url',
      };
      service.startOAuthConnection.mockResolvedValue(expectedResult as any);

      const result = await controller.startOAuthConnection(mockUser, dto);

      expect(service.startOAuthConnection).toHaveBeenCalledWith(mockUser.userId, dto);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getConnections', () => {
    it('should call CalendarService.getConnections', async () => {
      const expectedResult = [
        { id: 'conn-1', provider: CalendarProvider.GOOGLE, account_label: 'Test', status: CalendarConnectionStatus.ACTIVE, last_synced_at: null }
      ];
      service.getConnections.mockResolvedValue(expectedResult);

      const result = await controller.getConnections(mockUser);

      expect(service.getConnections).toHaveBeenCalledWith(mockUser.userId);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('syncConnection', () => {
    it('should call CalendarService.syncConnection', async () => {
      const connectionId = 'conn-123';
      const expectedResult = { connection_id: connectionId, status: CalendarConnectionStatus.SYNCING, queued: true };
      service.syncConnection.mockResolvedValue(expectedResult);

      const result = await controller.syncConnection(mockUser, connectionId);

      expect(service.syncConnection).toHaveBeenCalledWith(mockUser.userId, connectionId);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('revokeConnection', () => {
    it('should call CalendarService.revokeConnection', async () => {
      const connectionId = 'conn-123';
      const expectedResult = { connection_id: connectionId, status: CalendarConnectionStatus.REVOKED };
      service.revokeConnection.mockResolvedValue(expectedResult);

      const result = await controller.revokeConnection(mockUser, connectionId);

      expect(service.revokeConnection).toHaveBeenCalledWith(mockUser.userId, connectionId);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('listEvents', () => {
    it('should call CalendarService.listEvents with query', async () => {
      const query = { from: '2026-04-01T00:00:00.000Z', to: '2026-04-30T00:00:00.000Z' };
      service.listEvents.mockResolvedValue([]);

      const result = await controller.listEvents(mockUser, query);

      expect(service.listEvents).toHaveBeenCalledWith(mockUser.userId, query);
      expect(result).toEqual([]);
    });
  });
});