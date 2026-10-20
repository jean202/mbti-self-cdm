import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { RedisService } from '../../infra/redis/redis.service';
import { FakeRedis } from '../../testing/fake-redis';
import { AuthTokenService } from '../auth/auth-token.service';
import { SessionService } from './session.service';

function createSessionService(env: Record<string, string> = {}) {
  const redis = new FakeRedis();
  const authTokenService = new AuthTokenService({
    get: jest.fn((key: string) => env[key]),
  } as unknown as ConfigService);
  const service = new SessionService(
    { getClient: () => redis } as unknown as RedisService,
    authTokenService,
  );

  return { service, redis, authTokenService };
}

const DEVICE = { platform: 'IOS', appVersion: '1.0.0' };

describe('SessionService', () => {
  it('stores the session with the refresh TTL and only the refresh token hash', async () => {
    const { service, redis, authTokenService } = createSessionService({
      AUTH_REFRESH_TOKEN_TTL_SECONDS: '1209600',
    });

    const tokens = await service.createSession({
      userId: 'user-1',
      deviceId: 'device-1',
      ...DEVICE,
    });

    const sessionKey = `auth:session:${tokens.session_id}`;
    const stored = JSON.parse(redis.strings.get(sessionKey)!);
    expect(stored).toMatchObject({
      sessionId: tokens.session_id,
      userId: 'user-1',
      deviceId: 'device-1',
      refreshTokenHash: authTokenService.hashRefreshToken(tokens.refresh_token),
    });
    expect(JSON.stringify(stored)).not.toContain(tokens.refresh_token);
    expect(redis.ttls.get(sessionKey)).toBe(1209600);
    expect(await redis.smembers('auth:user-sessions:user-1')).toEqual([
      tokens.session_id,
    ]);
    expect(redis.ttls.get('auth:user-sessions:user-1')).toBe(1209600);

    const claims = authTokenService.verifyAccessToken(tokens.access_token);
    expect(claims).toMatchObject({
      sub: 'user-1',
      sid: tokens.session_id,
      did: 'device-1',
    });
  });

  it('validates an access session only for its owner', async () => {
    const { service } = createSessionService();
    const tokens = await service.createSession({ userId: 'user-1', ...DEVICE });

    await expect(
      service.validateAccessSession(tokens.session_id, 'user-1'),
    ).resolves.toMatchObject({ userId: 'user-1' });
    await expect(
      service.validateAccessSession(tokens.session_id, 'user-2'),
    ).rejects.toThrow('Session is invalid.');
    await expect(
      service.validateAccessSession('missing-session', 'user-1'),
    ).rejects.toThrow('Session is invalid.');
  });

  describe('rotateRefreshToken', () => {
    it('issues a new refresh token and invalidates the old one', async () => {
      const { service } = createSessionService();
      const original = await service.createSession({
        userId: 'user-1',
        deviceId: 'device-1',
        ...DEVICE,
      });

      const rotated = await service.rotateRefreshToken({
        sessionId: original.session_id,
        refreshToken: original.refresh_token,
        deviceId: 'device-1',
      });

      expect(rotated.session_id).toBe(original.session_id);
      expect(rotated.refresh_token).not.toBe(original.refresh_token);
      await expect(
        service.rotateRefreshToken({
          sessionId: original.session_id,
          refreshToken: original.refresh_token,
        }),
      ).rejects.toThrow('Refresh token is invalid.');
      await expect(
        service.rotateRefreshToken({
          sessionId: original.session_id,
          refreshToken: rotated.refresh_token,
        }),
      ).resolves.toMatchObject({ session_id: original.session_id });
    });

    it('rejects an unknown session', async () => {
      const { service } = createSessionService();

      await expect(
        service.rotateRefreshToken({ sessionId: 'nope', refreshToken: 'x' }),
      ).rejects.toThrow('Session was not found.');
    });

    it('rejects a refresh from a different device', async () => {
      const { service } = createSessionService();
      const tokens = await service.createSession({
        userId: 'user-1',
        deviceId: 'device-1',
        ...DEVICE,
      });

      await expect(
        service.rotateRefreshToken({
          sessionId: tokens.session_id,
          refreshToken: tokens.refresh_token,
          deviceId: 'device-2',
        }),
      ).rejects.toThrow('Device does not match session.');
    });

    it('allows a refresh without a device id when the session has none', async () => {
      const { service } = createSessionService();
      const tokens = await service.createSession({ userId: 'user-1', ...DEVICE });

      await expect(
        service.rotateRefreshToken({
          sessionId: tokens.session_id,
          refreshToken: tokens.refresh_token,
          deviceId: 'any-device',
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('revokeSession', () => {
    it('removes the session and its membership in the user index', async () => {
      const { service, redis } = createSessionService();
      const kept = await service.createSession({ userId: 'user-1', ...DEVICE });
      const revoked = await service.createSession({ userId: 'user-1', ...DEVICE });

      await service.revokeSession(revoked.session_id, 'user-1', revoked.refresh_token);

      expect(redis.strings.has(`auth:session:${revoked.session_id}`)).toBe(false);
      expect(await redis.smembers('auth:user-sessions:user-1')).toEqual([
        kept.session_id,
      ]);
      await expect(
        service.validateAccessSession(kept.session_id, 'user-1'),
      ).resolves.toBeDefined();
    });

    it("refuses to revoke someone else's session", async () => {
      const { service } = createSessionService();
      const tokens = await service.createSession({ userId: 'user-1', ...DEVICE });

      await expect(
        service.revokeSession(tokens.session_id, 'user-2'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        service.validateAccessSession(tokens.session_id, 'user-1'),
      ).resolves.toBeDefined();
    });

    it('refuses to revoke with a refresh token that does not match', async () => {
      const { service } = createSessionService();
      const tokens = await service.createSession({ userId: 'user-1', ...DEVICE });

      await expect(
        service.revokeSession(tokens.session_id, 'user-1', 'wrong-token'),
      ).rejects.toThrow('Refresh token is invalid.');
    });

    it('treats an already missing session as revoked', async () => {
      const { service } = createSessionService();

      await expect(
        service.revokeSession('missing', 'user-1'),
      ).resolves.toBeUndefined();
    });
  });

  it('revokes every session of a user and leaves other users alone', async () => {
    const { service, redis } = createSessionService();
    const first = await service.createSession({ userId: 'user-1', ...DEVICE });
    const second = await service.createSession({ userId: 'user-1', ...DEVICE });
    const other = await service.createSession({ userId: 'user-2', ...DEVICE });

    await service.revokeAllSessions('user-1');

    for (const tokens of [first, second]) {
      await expect(
        service.validateAccessSession(tokens.session_id, 'user-1'),
      ).rejects.toThrow('Session is invalid.');
    }
    expect(redis.sets.has('auth:user-sessions:user-1')).toBe(false);
    await expect(
      service.validateAccessSession(other.session_id, 'user-2'),
    ).resolves.toBeDefined();
  });

  it('does nothing when revoking all sessions of a user without sessions', async () => {
    const { service } = createSessionService();

    await expect(service.revokeAllSessions('nobody')).resolves.toBeUndefined();
  });
});
