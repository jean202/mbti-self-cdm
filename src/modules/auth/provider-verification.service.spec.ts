import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider } from '@prisma/client';

import { ProviderVerificationService } from './provider-verification.service';

describe('ProviderVerificationService', () => {
  let service: ProviderVerificationService;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    service = new ProviderVerificationService({
      get: jest.fn(),
    } as unknown as ConfigService);
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('verifies Kakao access tokens through the Kakao user API', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 12345,
        kakao_account: {
          email: 'User@Example.com',
          profile: { nickname: 'Jean' },
        },
      }),
    } as Response);

    const result = await service.verify({
      provider: AuthProvider.KAKAO,
      provider_payload: {
        access_token: 'kakao-access-token',
      },
      device: {
        device_id: 'device-1',
        platform: 'ios',
        app_version: '1.0.0',
      },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://kapi.kakao.com/v2/user/me',
      {
        headers: {
          Authorization: 'Bearer kakao-access-token',
        },
      },
    );
    expect(result).toMatchObject({
      provider: AuthProvider.KAKAO,
      providerUserId: '12345',
      providerEmail: 'user@example.com',
      providerDisplayName: 'Jean',
    });
    expect(result.rawProfileJson).toMatchObject({
      mode: 'kakao-access-token',
    });
  });

  it('rejects invalid Kakao access tokens', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response);

    await expect(
      service.verify({
        provider: AuthProvider.KAKAO,
        provider_payload: {
          access_token: 'expired-token',
        },
        device: {
          device_id: 'device-1',
          platform: 'ios',
          app_version: '1.0.0',
        },
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
