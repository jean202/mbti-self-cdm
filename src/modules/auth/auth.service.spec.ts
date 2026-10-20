import { AuthProvider, OnboardingStatus } from '@prisma/client';

import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { SessionService } from '../session/session.service';
import { AuthService } from './auth.service';
import type { ProviderVerificationService } from './provider-verification.service';
import type { SocialLoginDto } from './dto/social-login.dto';

const TOKENS = {
  access_token: 'access',
  access_token_expires_in: 3600,
  refresh_token: 'refresh',
  refresh_token_expires_in: 2592000,
  session_id: 'session-1',
};

const LOGIN: SocialLoginDto = {
  provider: AuthProvider.GOOGLE,
  provider_payload: { id_token: 'id-token' },
  device: { device_id: 'device-1', platform: 'IOS', app_version: '1.2.3' },
};

const USER = {
  id: 'user-1',
  displayName: null as string | null,
  primaryEmail: null as string | null,
  locale: 'ko-KR',
  timezone: 'Asia/Seoul',
  onboardingStatus: OnboardingStatus.MBTI_PENDING,
};

function createHarness() {
  const tx = {
    user: {
      create: jest.fn().mockImplementation(({ data }) => ({ ...USER, ...data })),
      update: jest.fn().mockImplementation(({ data }) => ({ ...USER, ...data })),
    },
    authIdentity: {
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const prisma = {
    authIdentity: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const sessionService = {
    createSession: jest.fn().mockResolvedValue(TOKENS),
    rotateRefreshToken: jest.fn().mockResolvedValue(TOKENS),
    revokeSession: jest.fn(),
    revokeAllSessions: jest.fn(),
  };
  const providerVerification = {
    verify: jest.fn().mockResolvedValue({
      provider: AuthProvider.GOOGLE,
      providerUserId: 'google-sub-1',
      providerEmail: 'jean@example.com',
      providerDisplayName: 'Jean',
      rawProfileJson: { sub: 'google-sub-1' },
    }),
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    sessionService as unknown as SessionService,
    providerVerification as unknown as ProviderVerificationService,
  );

  return { service, prisma, tx, sessionService, providerVerification };
}

describe('AuthService', () => {
  describe('socialLogin', () => {
    it('creates the user and identity together on first login', async () => {
      const { service, tx, sessionService } = createHarness();

      const result = await service.socialLogin(LOGIN);

      expect(tx.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          displayName: 'Jean',
          primaryEmail: 'jean@example.com',
          onboardingStatus: OnboardingStatus.MBTI_PENDING,
        }),
      });
      expect(tx.authIdentity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          provider: AuthProvider.GOOGLE,
          providerUserId: 'google-sub-1',
          rawProfileJson: { sub: 'google-sub-1' },
        }),
      });
      expect(sessionService.createSession).toHaveBeenCalledWith({
        userId: 'user-1',
        deviceId: 'device-1',
        platform: 'IOS',
        appVersion: '1.2.3',
      });
      expect(result).toEqual({
        tokens: TOKENS,
        user: {
          id: 'user-1',
          display_name: 'Jean',
          primary_email: 'jean@example.com',
          locale: 'ko-KR',
          timezone: 'Asia/Seoul',
          onboarding_status: OnboardingStatus.MBTI_PENDING,
        },
        onboarding: {
          status: OnboardingStatus.MBTI_PENDING,
          next_step: 'MBTI_ENTRY',
          is_completed: false,
        },
      });
    });

    it('updates an existing identity without overwriting profile fields the user already has', async () => {
      const { service, prisma, tx } = createHarness();
      prisma.authIdentity.findUnique.mockResolvedValue({
        id: 'identity-1',
        userId: 'user-1',
        providerEmail: 'old@example.com',
        providerDisplayName: 'Old Name',
        user: {
          ...USER,
          displayName: 'Chosen Name',
          primaryEmail: 'chosen@example.com',
          onboardingStatus: OnboardingStatus.COMPLETED,
        },
      });
      tx.user.update.mockImplementation(({ data }) => ({
        ...USER,
        ...data,
        onboardingStatus: OnboardingStatus.COMPLETED,
      }));

      const result = await service.socialLogin(LOGIN);

      expect(tx.user.create).not.toHaveBeenCalled();
      expect(tx.authIdentity.update).toHaveBeenCalledWith({
        where: { id: 'identity-1' },
        data: expect.objectContaining({
          providerEmail: 'jean@example.com',
          providerDisplayName: 'Jean',
          lastLoginAt: expect.any(Date),
        }),
      });
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          displayName: 'Chosen Name',
          primaryEmail: 'chosen@example.com',
        }),
      });
      expect(result.onboarding).toEqual({
        status: OnboardingStatus.COMPLETED,
        next_step: 'HOME',
        is_completed: true,
      });
    });

    it('keeps the stored provider email when the provider stops sending one', async () => {
      const { service, prisma, tx, providerVerification } = createHarness();
      providerVerification.verify.mockResolvedValue({
        provider: AuthProvider.KAKAO,
        providerUserId: '123',
        rawProfileJson: {},
      });
      prisma.authIdentity.findUnique.mockResolvedValue({
        id: 'identity-1',
        userId: 'user-1',
        providerEmail: 'kept@example.com',
        providerDisplayName: 'Kept',
        user: USER,
      });

      await service.socialLogin({ ...LOGIN, provider: AuthProvider.KAKAO });

      expect(tx.authIdentity.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerEmail: 'kept@example.com',
            providerDisplayName: 'Kept',
          }),
        }),
      );
    });

    it('does not create a session when provider verification fails', async () => {
      const { service, providerVerification, sessionService } = createHarness();
      providerVerification.verify.mockRejectedValue(new Error('bad token'));

      await expect(service.socialLogin(LOGIN)).rejects.toThrow('bad token');
      expect(sessionService.createSession).not.toHaveBeenCalled();
    });
  });

  it('rotates refresh tokens through the session service', async () => {
    const { service, sessionService } = createHarness();

    await expect(
      service.refresh({
        refresh_token: 'refresh',
        session_id: 'session-1',
        device_id: 'device-1',
      }),
    ).resolves.toEqual({ tokens: TOKENS });
    expect(sessionService.rotateRefreshToken).toHaveBeenCalledWith({
      sessionId: 'session-1',
      refreshToken: 'refresh',
      deviceId: 'device-1',
    });
  });

  it('revokes only the current session by default', async () => {
    const { service, sessionService } = createHarness();
    const currentUser = { userId: 'user-1', sessionId: 'session-1' };

    await expect(
      service.logout(currentUser, { refresh_token: 'refresh', logout_all_devices: false }),
    ).resolves.toEqual({ success: true });
    expect(sessionService.revokeSession).toHaveBeenCalledWith(
      'session-1',
      'user-1',
      'refresh',
    );
    expect(sessionService.revokeAllSessions).not.toHaveBeenCalled();
  });

  it('revokes every session when logging out of all devices', async () => {
    const { service, sessionService } = createHarness();

    await service.logout(
      { userId: 'user-1', sessionId: 'session-1' },
      { logout_all_devices: true },
    );

    expect(sessionService.revokeAllSessions).toHaveBeenCalledWith('user-1');
    expect(sessionService.revokeSession).not.toHaveBeenCalled();
  });
});
