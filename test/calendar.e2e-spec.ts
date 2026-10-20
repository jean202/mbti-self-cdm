import {
  authed,
  createE2eApp,
  expectStatus,
  loginNewUser,
  loginOnboardedUser,
  type E2eApp,
  type LoggedInUser,
} from './support/e2e-app';

const REDIRECT_URI = 'mbtiapp://calendar/oauth-result';

describe('Calendar (e2e)', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    // 실제 Google 토큰 교환 대신 dev bridge(빈 이벤트를 돌려주는 stub adapter)를 쓴다.
    ctx = await createE2eApp({
      env: {
        CALENDAR_ENABLE_DEV_OAUTH_BRIDGE: 'true',
        CALENDAR_GOOGLE_CLIENT_ID: 'e2e-google-client-id',
        CALENDAR_GOOGLE_CALLBACK_URI:
          'https://api.example.test/v1/internal/calendar/oauth/google/callback',
      },
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function startOAuth(user: LoggedInUser) {
    const response = await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: '/v1/calendar/connections/oauth/start',
        payload: { provider: 'google', redirect_uri: REDIRECT_URI },
      }),
      201,
    );

    return response.json().data as {
      provider: string;
      flow_id: string;
      authorize_url: string;
    };
  }

  function callback(query: Record<string, string>) {
    return ctx.app.inject({
      method: 'GET',
      url: '/v1/internal/calendar/oauth/google/callback',
      query,
    });
  }

  function redirectParams(location: string | undefined) {
    expect(location).toBeDefined();
    const url = new URL(location!);
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(REDIRECT_URI);

    return url.searchParams;
  }

  async function connectGoogle(user: LoggedInUser): Promise<string> {
    const { flow_id } = await startOAuth(user);
    const response = await callback({ state: flow_id, code: 'e2e-code' });
    const params = redirectParams(response.headers.location as string);

    expect(response.statusCode).toBe(302);
    expect(params.get('calendar_oauth_status')).toBe('success');

    return params.get('connection_id')!;
  }

  async function waitForSync(user: LoggedInUser, connectionId: string) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await authed(ctx.app, user, {
        method: 'GET',
        url: '/v1/calendar/connections',
      });
      const connection = response
        .json()
        .data.find((item: { id: string }) => item.id === connectionId);

      if (connection?.status === 'ACTIVE' && connection.last_synced_at) {
        return connection;
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    throw new Error(`connection ${connectionId} was not synced in time`);
  }

  it('builds a Google authorize URL bound to a one-time state', async () => {
    const user = await loginOnboardedUser(ctx.app);

    const { flow_id, authorize_url } = await startOAuth(user);
    const url = new URL(authorize_url);

    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'e2e-google-client-id',
      redirect_uri:
        'https://api.example.test/v1/internal/calendar/oauth/google/callback',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      state: flow_id,
      access_type: 'offline',
    });
  });

  it('completes the callback, finishes onboarding and syncs through the worker', async () => {
    const user = await loginNewUser(ctx.app);
    await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: '/v1/mbti/profile/confirm',
        payload: { type_code: 'ISTJ', source: 'SELF_SELECTED' },
      }),
      201,
    );

    const connectionId = await connectGoogle(user);

    const me = await expectStatus(
      authed(ctx.app, user, { method: 'GET', url: '/v1/me' }),
      200,
    );
    expect(me.json().data.user.onboarding_status).toBe('COMPLETED');
    expect(me.json().data.calendar_connections).toEqual([
      expect.objectContaining({
        id: connectionId,
        provider: 'GOOGLE',
        status: 'ACTIVE',
        account_label: 'Google Calendar',
      }),
    ]);

    const sync = await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: `/v1/calendar/connections/${connectionId}/sync`,
      }),
      201,
    );
    expect(sync.json().data).toEqual({
      connection_id: connectionId,
      status: 'SYNCING',
      queued: true,
    });

    const synced = await waitForSync(user, connectionId);
    expect(new Date(synced.last_synced_at).getTime()).not.toBeNaN();
  });

  it('accepts each OAuth state only once', async () => {
    const user = await loginOnboardedUser(ctx.app);
    const { flow_id } = await startOAuth(user);

    const first = await callback({ state: flow_id, code: 'e2e-code' });
    expect(first.statusCode).toBe(302);

    const replay = await callback({ state: flow_id, code: 'e2e-code' });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().error.code).toBe('INVALID_CALENDAR_OAUTH_STATE');
  });

  it('redirects back with a failure when the user denies consent', async () => {
    const user = await loginOnboardedUser(ctx.app);
    const { flow_id } = await startOAuth(user);

    const response = await callback({
      state: flow_id,
      error: 'access_denied',
    });
    const params = redirectParams(response.headers.location as string);

    expect(response.statusCode).toBe(302);
    expect(params.get('calendar_oauth_status')).toBe('failed');
    expect(params.get('error_code')).toBe('CALENDAR_OAUTH_DENIED');

    const connections = await expectStatus(
      authed(ctx.app, user, { method: 'GET', url: '/v1/calendar/connections' }),
      200,
    );
    expect(connections.json().data).toEqual([]);
  });

  it('refuses to connect before MBTI confirmation', async () => {
    const user = await loginNewUser(ctx.app);
    const { flow_id } = await startOAuth(user);

    const response = await callback({ state: flow_id, code: 'e2e-code' });
    const params = redirectParams(response.headers.location as string);

    expect(params.get('calendar_oauth_status')).toBe('failed');
    expect(params.get('error_code')).toBe('CALENDAR_ONBOARDING_NOT_READY');
  });

  it('refuses web redirect URIs so the public callback cannot become an open redirect', async () => {
    const user = await loginOnboardedUser(ctx.app);

    const response = await authed(ctx.app, user, {
      method: 'POST',
      url: '/v1/calendar/connections/oauth/start',
      payload: { provider: 'GOOGLE', redirect_uri: 'https://evil.example/landing' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_CALENDAR_REDIRECT_URI');
  });

  it('rejects redirect URIs without a scheme', async () => {
    const user = await loginOnboardedUser(ctx.app);

    const response = await authed(ctx.app, user, {
      method: 'POST',
      url: '/v1/calendar/connections/oauth/start',
      payload: { provider: 'GOOGLE', redirect_uri: '/relative/path' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('revokes a connection, hides it from /me and blocks further syncs', async () => {
    const user = await loginOnboardedUser(ctx.app);
    const connectionId = await connectGoogle(user);

    const revoked = await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: `/v1/calendar/connections/${connectionId}/revoke`,
      }),
      201,
    );
    expect(revoked.json().data).toEqual({
      connection_id: connectionId,
      status: 'REVOKED',
    });

    const sync = await authed(ctx.app, user, {
      method: 'POST',
      url: `/v1/calendar/connections/${connectionId}/sync`,
    });
    expect(sync.statusCode).toBe(409);

    const me = await expectStatus(
      authed(ctx.app, user, { method: 'GET', url: '/v1/me' }),
      200,
    );
    expect(me.json().data.calendar_connections).toEqual([]);
  });

  it("does not let a user touch another user's connection", async () => {
    const owner = await loginOnboardedUser(ctx.app);
    const stranger = await loginOnboardedUser(ctx.app);
    const connectionId = await connectGoogle(owner);

    for (const action of ['sync', 'revoke']) {
      const response = await authed(ctx.app, stranger, {
        method: 'POST',
        url: `/v1/calendar/connections/${connectionId}/${action}`,
      });
      expect(response.statusCode).toBe(404);
    }

    const events = await authed(ctx.app, stranger, {
      method: 'GET',
      url: '/v1/calendar/events',
      query: {
        from: '2026-01-01T00:00:00Z',
        to: '2026-02-01T00:00:00Z',
        connection_id: connectionId,
      },
    });
    expect(events.statusCode).toBe(404);
  });

  it('validates the event listing window', async () => {
    const user = await loginOnboardedUser(ctx.app);

    const inverted = await authed(ctx.app, user, {
      method: 'GET',
      url: '/v1/calendar/events',
      query: { from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
    });
    expect(inverted.statusCode).toBe(400);

    const empty = await expectStatus(
      authed(ctx.app, user, {
        method: 'GET',
        url: '/v1/calendar/events',
        query: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' },
      }),
      200,
    );
    expect(empty.json().data).toEqual([]);
  });

  it('answers malformed ids with 400 instead of a server error', async () => {
    const user = await loginOnboardedUser(ctx.app);

    for (const request of [
      { method: 'POST' as const, url: '/v1/calendar/connections/not-a-uuid/sync' },
      { method: 'POST' as const, url: '/v1/calendar/connections/not-a-uuid/revoke' },
      { method: 'GET' as const, url: '/v1/mbti/finder/attempts/not-a-uuid' },
    ]) {
      const response = await authed(ctx.app, user, request);
      expect({ url: request.url, status: response.statusCode }).toEqual({
        url: request.url,
        status: 400,
      });
    }
  });
});
