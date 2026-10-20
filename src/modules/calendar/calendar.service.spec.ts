import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CalendarConnectionStatus,
  CalendarProvider,
  OnboardingStatus,
  Prisma,
} from '@prisma/client';

import type { SecretsService } from '../../common/secrets/secrets.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { QueueService } from '../../infra/queue/queue.service';
import type { RedisService } from '../../infra/redis/redis.service';
import { FakeRedis } from '../../testing/fake-redis';
import { CalendarService } from './calendar.service';

const getToken = jest.fn();
const OAuth2 = jest.fn((..._args: unknown[]) => ({ getToken }));

jest.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: jest.fn((...args: unknown[]) => OAuth2(...args)) },
  },
}));

const REDIRECT_URI = 'mbtiapp://calendar/result';

function createHarness(env: Record<string, string> = {}) {
  const redis = new FakeRedis();
  const queue = { add: jest.fn() };
  const tx = {
    calendarConnection: {
      upsert: jest.fn().mockResolvedValue({
        id: 'conn-1',
        status: CalendarConnectionStatus.ACTIVE,
      }),
    },
    user: { update: jest.fn() },
  };
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'user-1',
        onboardingStatus: OnboardingStatus.CALENDAR_PENDING,
      }),
      update: jest.fn(),
    },
    calendarConnection: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'conn-1',
        provider: CalendarProvider.GOOGLE,
        status: CalendarConnectionStatus.ACTIVE,
      }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(({ where, data }) => ({
        id: where.id,
        status: data.status,
      })),
    },
    calendarEvent: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const secrets = { encrypt: jest.fn((value: string) => `enc(${value})`) };
  const service = new CalendarService(
    prisma as unknown as PrismaService,
    { getQueue: jest.fn(() => queue) } as unknown as QueueService,
    { getClient: () => redis } as unknown as RedisService,
    { get: jest.fn((key: string) => env[key]) } as unknown as ConfigService,
    secrets as unknown as SecretsService,
  );

  return { service, redis, queue, prisma, tx, secrets };
}

function redirectParams(redirectTo: string) {
  return Object.fromEntries(new URL(redirectTo).searchParams);
}

describe('CalendarService', () => {
  beforeEach(() => {
    getToken.mockReset();
    OAuth2.mockClear();
  });

  describe('startOAuthConnection', () => {
    it('stores a short-lived state and returns a Google consent URL', async () => {
      const { service, redis } = createHarness({
        CALENDAR_GOOGLE_CLIENT_ID: 'client-123',
        CALENDAR_GOOGLE_CALLBACK_URI: 'https://api.example.com/cb',
      });

      const result = await service.startOAuthConnection('user-1', {
        provider: CalendarProvider.GOOGLE,
        redirect_uri: REDIRECT_URI,
      });

      const stateKey = `oauth_state:GOOGLE:${result.flow_id}`;
      expect(JSON.parse(redis.strings.get(stateKey)!)).toMatchObject({
        flow_id: result.flow_id,
        user_id: 'user-1',
        provider: 'GOOGLE',
        redirect_uri: REDIRECT_URI,
        callback_uri: 'https://api.example.com/cb',
      });
      expect(redis.ttls.get(stateKey)).toBe(600);
      expect(redirectParams(result.authorize_url)).toEqual({
        client_id: 'client-123',
        redirect_uri: 'https://api.example.com/cb',
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/calendar.readonly',
        state: result.flow_id,
        access_type: 'offline',
        include_granted_scopes: 'true',
        prompt: 'consent',
      });
    });

    it('falls back to the login client id and an API_BASE_URL callback', async () => {
      const { service } = createHarness({
        GOOGLE_OAUTH_CLIENT_ID: 'login-client',
        API_BASE_URL: 'https://api.example.com/',
        CALENDAR_OAUTH_STATE_TTL_SECONDS: 'nonsense',
      });

      const result = await service.startOAuthConnection('user-1', {
        provider: CalendarProvider.GOOGLE,
        redirect_uri: REDIRECT_URI,
      });

      expect(redirectParams(result.authorize_url)).toMatchObject({
        client_id: 'login-client',
        redirect_uri:
          'https://api.example.com/v1/internal/calendar/oauth/google/callback',
      });
    });

    it('rejects providers without OAuth support', async () => {
      const { service } = createHarness();

      await expect(
        service.startOAuthConnection('user-1', {
          provider: CalendarProvider.APPLE,
          redirect_uri: REDIRECT_URI,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects unknown users', async () => {
      const { service, prisma } = createHarness();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.startOAuthConnection('ghost', {
          provider: CalendarProvider.GOOGLE,
          redirect_uri: REDIRECT_URI,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('completeOAuthConnection', () => {
    async function startFlow(env: Record<string, string> = {}) {
      const harness = createHarness({
        CALENDAR_GOOGLE_CLIENT_ID: 'client-123',
        CALENDAR_GOOGLE_CLIENT_SECRET: 'secret-456',
        CALENDAR_GOOGLE_CALLBACK_URI: 'https://api.example.com/cb',
        ...env,
      });
      const { flow_id } = await harness.service.startOAuthConnection('user-1', {
        provider: CalendarProvider.GOOGLE,
        redirect_uri: REDIRECT_URI,
      });

      return { ...harness, flowId: flow_id, stateKey: `oauth_state:GOOGLE:${flow_id}` };
    }

    it('exchanges the code, stores encrypted tokens and completes onboarding', async () => {
      const { service, tx, redis, flowId, stateKey, secrets } = await startFlow();
      getToken.mockResolvedValue({ tokens: { access_token: 'ya29', refresh_token: '1//r' } });

      const result = await service.completeOAuthConnection('google', {
        state: flowId,
        code: 'auth-code',
        account_label: '  Work  ',
      });

      expect(OAuth2).toHaveBeenCalledWith(
        'client-123',
        'secret-456',
        'https://api.example.com/cb',
      );
      expect(getToken).toHaveBeenCalledWith('auth-code');
      expect(secrets.encrypt).toHaveBeenCalledWith(
        JSON.stringify({ access_token: 'ya29', refresh_token: '1//r' }),
      );
      expect(tx.calendarConnection.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            userId: 'user-1',
            provider: CalendarProvider.GOOGLE,
            providerAccountId: 'dev-google-user-1',
            accountLabel: 'Work',
            credentialsRef: 'enc({"access_token":"ya29","refresh_token":"1//r"})',
            status: CalendarConnectionStatus.ACTIVE,
          }),
        }),
      );
      expect(tx.user.update.mock.calls[0][0].data.onboardingStatus).toBe(
        OnboardingStatus.COMPLETED,
      );
      expect(redis.strings.has(stateKey)).toBe(false);
      expect(result).toMatchObject({
        success: true,
        connection_id: 'conn-1',
        status: CalendarConnectionStatus.ACTIVE,
      });
      expect(redirectParams(result.redirect_to)).toEqual({
        calendar_oauth_status: 'success',
        provider: 'GOOGLE',
        flow_id: flowId,
        connection_id: 'conn-1',
      });
    });

    it('reports a failed token exchange back to the client and consumes the state', async () => {
      const { service, tx, redis, flowId, stateKey } = await startFlow();
      getToken.mockRejectedValue(new Error('invalid_grant'));

      const result = await service.completeOAuthConnection('GOOGLE', {
        state: flowId,
        code: 'expired-code',
      });

      expect(result).toMatchObject({ success: false, error_code: 'TOKEN_EXCHANGE_FAILED' });
      expect(tx.calendarConnection.upsert).not.toHaveBeenCalled();
      expect(redis.strings.has(stateKey)).toBe(false);
    });

    it('fails the exchange when the client secret is not configured', async () => {
      const { service, flowId } = await startFlow({ CALENDAR_GOOGLE_CLIENT_SECRET: '' });

      const result = await service.completeOAuthConnection('google', {
        state: flowId,
        code: 'auth-code',
      });

      expect(result.error_code).toBe('TOKEN_EXCHANGE_FAILED');
      expect(getToken).not.toHaveBeenCalled();
    });

    it('skips the exchange and stores no credentials in dev bridge mode', async () => {
      const { service, tx, flowId } = await startFlow({
        CALENDAR_ENABLE_DEV_OAUTH_BRIDGE: 'TRUE',
      });

      const result = await service.completeOAuthConnection('google', { state: flowId });

      expect(result.success).toBe(true);
      expect(getToken).not.toHaveBeenCalled();
      expect(tx.calendarConnection.upsert.mock.calls[0][0].create.credentialsRef).toBeNull();
    });

    it('requires an authorization code outside dev bridge mode', async () => {
      const { service, flowId } = await startFlow();

      const result = await service.completeOAuthConnection('google', {
        state: flowId,
        code: '   ',
      });

      expect(result.error_code).toBe('CALENDAR_OAUTH_CODE_REQUIRED');
    });

    it('passes a provider denial through without creating a connection', async () => {
      const { service, tx, flowId } = await startFlow();

      const result = await service.completeOAuthConnection('google', {
        state: flowId,
        error: 'access_denied',
      });

      expect(result).toMatchObject({
        success: false,
        error_code: 'CALENDAR_OAUTH_DENIED',
        error_description: 'Provider returned access_denied.',
      });
      expect(redirectParams(result.redirect_to).calendar_oauth_status).toBe('failed');
      expect(tx.calendarConnection.upsert).not.toHaveBeenCalled();
    });

    it('refuses users that have not confirmed MBTI yet', async () => {
      const { service, prisma, flowId } = await startFlow();
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        onboardingStatus: OnboardingStatus.MBTI_PENDING,
      });

      const result = await service.completeOAuthConnection('google', {
        state: flowId,
        code: 'auth-code',
      });

      expect(result.error_code).toBe('CALENDAR_ONBOARDING_NOT_READY');
    });

    it('keeps the onboarding status of an already completed user', async () => {
      const { service, prisma, tx, flowId } = await startFlow();
      getToken.mockResolvedValue({ tokens: {} });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        onboardingStatus: OnboardingStatus.COMPLETED,
      });

      await service.completeOAuthConnection('google', { state: flowId, code: 'c' });

      expect(tx.user.update.mock.calls[0][0].data.onboardingStatus).toBe(
        OnboardingStatus.COMPLETED,
      );
    });

    it('rejects an unknown or expired state', async () => {
      const { service } = createHarness();

      await expect(
        service.completeOAuthConnection('google', {
          state: '00000000-0000-4000-8000-000000000000',
          code: 'c',
        }),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_CALENDAR_OAUTH_STATE' },
      });
    });

    it('rejects a stored state that is not valid JSON or is missing fields', async () => {
      const { service, redis } = createHarness();
      await redis.set('oauth_state:GOOGLE:broken', '{nope');
      await redis.set('oauth_state:GOOGLE:partial', JSON.stringify({ flow_id: 'partial' }));

      for (const state of ['broken', 'partial']) {
        await expect(
          service.completeOAuthConnection('google', { state, code: 'c' }),
        ).rejects.toMatchObject({
          response: { code: 'INVALID_CALENDAR_OAUTH_STATE' },
        });
      }
    });

    it('rejects a state that was stored for another provider', async () => {
      const { service, redis } = createHarness();
      await redis.set(
        'oauth_state:APPLE:flow-1',
        JSON.stringify({
          flow_id: 'flow-1',
          user_id: 'user-1',
          provider: 'GOOGLE',
          redirect_uri: REDIRECT_URI,
          callback_uri: 'https://api.example.com/cb',
        }),
      );

      await expect(
        service.completeOAuthConnection('apple', { state: 'flow-1', code: 'c' }),
      ).rejects.toMatchObject({
        response: { code: 'CALENDAR_OAUTH_PROVIDER_MISMATCH' },
      });
      expect(redis.strings.has('oauth_state:APPLE:flow-1')).toBe(false);
    });

    it('rejects unsupported provider names in the callback path', async () => {
      const { service } = createHarness();

      await expect(
        service.completeOAuthConnection('myspace', { state: 'x' }),
      ).rejects.toThrow('Unsupported calendar provider.');
    });
  });

  describe('redirect_uri allowlist', () => {
    async function start(redirectUri: string, env: Record<string, string> = {}) {
      return createHarness(env).service.startOAuthConnection('user-1', {
        provider: CalendarProvider.GOOGLE,
        redirect_uri: redirectUri,
      });
    }

    it.each([
      'mbtiapp://calendar/oauth-result',
      'myapp://calendar-connect',
      'com.example.app:/oauth2redirect',
    ])('accepts the app redirect %p by default', async (redirectUri) => {
      await expect(start(redirectUri)).resolves.toMatchObject({ provider: 'GOOGLE' });
    });

    it.each([
      'https://evil.example/landing',
      'http://localhost:3000/callback',
      'javascript://x%0aalert(1)',
      'data://text/html,hi',
      'not a url',
    ])('rejects the web or unsafe redirect %p by default', async (redirectUri) => {
      await expect(start(redirectUri)).rejects.toMatchObject({
        response: { code: 'INVALID_CALENDAR_REDIRECT_URI' },
      });
    });

    it('only accepts configured redirects when an allowlist is set', async () => {
      const env = {
        CALENDAR_OAUTH_ALLOWED_REDIRECT_URIS:
          'mbtiapp://calendar/oauth, https://app.example.com/calendar/',
      };

      await expect(start('mbtiapp://calendar/oauth', env)).resolves.toBeDefined();
      await expect(start('mbtiapp://calendar/oauth/done?x=1', env)).resolves.toBeDefined();
      await expect(start('https://app.example.com/calendar/return', env)).resolves.toBeDefined();

      for (const redirectUri of [
        'mbtiapp://calendar/oauth-evil',
        'mbtiapp://calendar.evil/oauth',
        'otherapp://calendar/oauth',
        'https://app.example.com/other',
        'https://app.example.com@evil.example/calendar/',
        'http://app.example.com/calendar/return',
      ]) {
        await expect(start(redirectUri, env)).rejects.toMatchObject({
          response: { code: 'INVALID_CALENDAR_REDIRECT_URI' },
        });
      }
    });

    it('stores nothing for a rejected redirect', async () => {
      const harness = createHarness();

      await expect(
        harness.service.startOAuthConnection('user-1', {
          provider: CalendarProvider.GOOGLE,
          redirect_uri: 'https://evil.example',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(harness.redis.strings.size).toBe(0);
    });

    it('refuses to redirect from a stored state whose redirect is not allowed', async () => {
      const { service, redis, tx } = createHarness();
      await redis.set(
        'oauth_state:GOOGLE:flow-1',
        JSON.stringify({
          flow_id: 'flow-1',
          user_id: 'user-1',
          provider: 'GOOGLE',
          redirect_uri: 'https://evil.example',
          callback_uri: 'https://api.example.com/cb',
        }),
      );

      await expect(
        service.completeOAuthConnection('google', { state: 'flow-1', error: 'access_denied' }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_CALENDAR_REDIRECT_URI' } });
      expect(redis.strings.has('oauth_state:GOOGLE:flow-1')).toBe(false);
      expect(tx.calendarConnection.upsert).not.toHaveBeenCalled();
    });
  });

  describe('syncConnection', () => {
    it('marks the connection as syncing and enqueues a job', async () => {
      const { service, queue, prisma } = createHarness();

      const result = await service.syncConnection('user-1', 'conn-1');

      expect(prisma.calendarConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conn-1' },
          data: { status: CalendarConnectionStatus.SYNCING, lastErrorCode: null },
        }),
      );
      expect(queue.add).toHaveBeenCalledWith('sync-connection', {
        connection_id: 'conn-1',
        user_id: 'user-1',
        provider: CalendarProvider.GOOGLE,
        requested_at: expect.any(String),
      });
      expect(result).toEqual({
        connection_id: 'conn-1',
        status: CalendarConnectionStatus.SYNCING,
        queued: true,
      });
    });

    it('refuses to sync a revoked connection', async () => {
      const { service, prisma, queue } = createHarness();
      prisma.calendarConnection.findFirst.mockResolvedValue({
        id: 'conn-1',
        provider: CalendarProvider.GOOGLE,
        status: CalendarConnectionStatus.REVOKED,
      });

      await expect(service.syncConnection('user-1', 'conn-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(queue.add).not.toHaveBeenCalled();
    });

    it("scopes the lookup to the user's own connections", async () => {
      const { service, prisma } = createHarness();
      prisma.calendarConnection.findFirst.mockResolvedValue(null);

      await expect(service.syncConnection('user-2', 'conn-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.calendarConnection.findFirst.mock.calls[0][0].where).toEqual({
        id: 'conn-1',
        userId: 'user-2',
      });
    });
  });

  it('revokes a connection and wipes its credentials and cursor', async () => {
    const { service, prisma } = createHarness();

    const result = await service.revokeConnection('user-1', 'conn-1');

    expect(prisma.calendarConnection.update.mock.calls[0][0].data).toMatchObject({
      status: CalendarConnectionStatus.REVOKED,
      revokedAt: expect.any(Date),
      credentialsRef: null,
      syncCursorJson: Prisma.JsonNull,
    });
    expect(result).toEqual({
      connection_id: 'conn-1',
      status: CalendarConnectionStatus.REVOKED,
    });
  });

  describe('listEvents', () => {
    it('queries overlapping events and serializes them', async () => {
      const { service, prisma } = createHarness();
      prisma.calendarEvent.findMany.mockResolvedValue([
        {
          id: 'event-1',
          connectionId: 'conn-1',
          title: 'Standup',
          startsAt: new Date('2026-01-05T00:00:00Z'),
          endsAt: new Date('2026-01-05T00:15:00Z'),
          isAllDay: false,
          eventStatus: 'CONFIRMED',
          calendarName: 'Work',
        },
      ]);

      const events = await service.listEvents('user-1', {
        from: '2026-01-05T00:00:00Z',
        to: '2026-01-06T00:00:00Z',
      });

      expect(prisma.calendarEvent.findMany.mock.calls[0][0].where).toEqual({
        userId: 'user-1',
        connectionId: undefined,
        endsAt: { gt: new Date('2026-01-05T00:00:00Z') },
        startsAt: { lt: new Date('2026-01-06T00:00:00Z') },
      });
      expect(events).toEqual([
        {
          id: 'event-1',
          connection_id: 'conn-1',
          title: 'Standup',
          starts_at: '2026-01-05T00:00:00.000Z',
          ends_at: '2026-01-05T00:15:00.000Z',
          is_all_day: false,
          event_status: 'CONFIRMED',
          calendar_name: 'Work',
        },
      ]);
    });

    it.each([
      ['an empty window', '2026-01-05T00:00:00Z', '2026-01-05T00:00:00Z'],
      ['an inverted window', '2026-01-06T00:00:00Z', '2026-01-05T00:00:00Z'],
      ['an invalid timestamp', 'yesterday', '2026-01-05T00:00:00Z'],
    ])('rejects %s', async (_label, from, to) => {
      const { service } = createHarness();

      await expect(service.listEvents('user-1', { from, to })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('skipCalendarOnboarding', () => {
    it('completes onboarding for a user who confirmed MBTI', async () => {
      const { service, prisma } = createHarness();

      const result = await service.skipCalendarOnboarding('user-1');

      expect(prisma.user.update.mock.calls[0][0].data.onboardingStatus).toBe(
        OnboardingStatus.COMPLETED,
      );
      expect(result.onboarding.is_completed).toBe(true);
    });

    it.each([OnboardingStatus.AUTH_ONLY, OnboardingStatus.MBTI_PENDING])(
      'refuses to skip while %s',
      async (onboardingStatus) => {
        const { service, prisma } = createHarness();
        prisma.user.findUnique.mockResolvedValue({ id: 'user-1', onboardingStatus });

        await expect(service.skipCalendarOnboarding('user-1')).rejects.toBeInstanceOf(
          ConflictException,
        );
      },
    );
  });
});
