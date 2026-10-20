import { NotFoundException } from '@nestjs/common';
import {
  CalendarConnectionStatus,
  CalendarProvider,
  MbtiSource,
  OnboardingStatus,
  Prisma,
} from '@prisma/client';

import type { PrismaService } from '../../infra/prisma/prisma.service';
import { MeService } from './me.service';

function createService(user: unknown) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockImplementation(({ data }) => ({
        id: 'user-1',
        locale: 'ko-KR',
        timezone: 'Asia/Seoul',
        notificationPrefsJson: null,
        ...data,
      })),
    },
  };

  return { service: new MeService(prisma as unknown as PrismaService), prisma };
}

describe('MeService', () => {
  describe('getMe', () => {
    it('maps the user, MBTI profile and active calendar connections', async () => {
      const { service, prisma } = createService({
        id: 'user-1',
        displayName: 'Jean',
        primaryEmail: 'jean@example.com',
        locale: 'ko-KR',
        timezone: 'Asia/Seoul',
        onboardingStatus: OnboardingStatus.COMPLETED,
        notificationPrefsJson: { enabled: true },
        mbtiProfile: {
          typeCode: 'INFP',
          source: MbtiSource.FINDER_RESULT,
          isUserConfirmed: true,
          confidenceScore: new Prisma.Decimal('0.8125'),
          profileVersion: '2026-03-v1',
        },
        calendarConnections: [
          {
            id: 'conn-1',
            provider: CalendarProvider.GOOGLE,
            accountLabel: 'Work',
            status: CalendarConnectionStatus.ACTIVE,
          },
        ],
      });

      const result = await service.getMe('user-1');

      expect(result).toEqual({
        user: {
          id: 'user-1',
          display_name: 'Jean',
          primary_email: 'jean@example.com',
          locale: 'ko-KR',
          timezone: 'Asia/Seoul',
          onboarding_status: OnboardingStatus.COMPLETED,
          notification_prefs: { enabled: true },
        },
        mbti_profile: {
          type_code: 'INFP',
          source: MbtiSource.FINDER_RESULT,
          is_user_confirmed: true,
          confidence_score: 0.8125,
          profile_version: '2026-03-v1',
        },
        calendar_connections: [
          { id: 'conn-1', provider: 'GOOGLE', account_label: 'Work', status: 'ACTIVE' },
        ],
      });
      expect(
        prisma.user.findUnique.mock.calls[0][0].select.calendarConnections.where,
      ).toEqual({ status: { not: CalendarConnectionStatus.REVOKED } });
    });

    it('returns null for a missing MBTI profile, confidence and prefs', async () => {
      const { service } = createService({
        id: 'user-1',
        displayName: null,
        primaryEmail: null,
        locale: 'ko-KR',
        timezone: 'Asia/Seoul',
        onboardingStatus: OnboardingStatus.MBTI_PENDING,
        notificationPrefsJson: null,
        mbtiProfile: null,
        calendarConnections: [],
      });

      const result = await service.getMe('user-1');

      expect(result.mbti_profile).toBeNull();
      expect(result.user.notification_prefs).toBeNull();
    });

    it('throws when the user does not exist', async () => {
      const { service } = createService(null);

      await expect(service.getMe('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updatePreferences', () => {
    it('merges notification preferences into the stored ones', async () => {
      const { service, prisma } = createService({
        id: 'user-1',
        notificationPrefsJson: {
          enabled: false,
          quiet_hours: { start: '23:00', end: '07:00' },
        },
      });

      await service.updatePreferences('user-1', {
        notification_prefs: { enabled: true },
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            notificationPrefsJson: {
              enabled: true,
              quiet_hours: { start: '23:00', end: '07:00' },
            },
          },
        }),
      );
    });

    it('only writes the fields that were sent', async () => {
      const { service, prisma } = createService({
        id: 'user-1',
        notificationPrefsJson: null,
      });

      const result = await service.updatePreferences('user-1', {
        timezone: 'Europe/Berlin',
      });

      expect(prisma.user.update.mock.calls[0][0].data).toEqual({
        timezone: 'Europe/Berlin',
      });
      expect(result).toEqual({
        locale: 'ko-KR',
        timezone: 'Europe/Berlin',
        notification_prefs: null,
      });
    });

    it('throws when the user does not exist', async () => {
      const { service } = createService(null);

      await expect(
        service.updatePreferences('ghost', { locale: 'en-US' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
