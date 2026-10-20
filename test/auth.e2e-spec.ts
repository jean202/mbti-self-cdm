import {
  authed,
  createE2eApp,
  expectStatus,
  loginNewUser,
  type E2eApp,
} from './support/e2e-app';

describe('Auth (e2e)', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('creates a user on first social login and starts onboarding at MBTI entry', async () => {
    const user = await loginNewUser(ctx.app);

    const response = await expectStatus(
      authed(ctx.app, user, { method: 'GET', url: '/v1/me' }),
      200,
    );
    const { data } = response.json();

    expect(data.user.id).toBe(user.userId);
    expect(data.user.onboarding_status).toBe('MBTI_PENDING');
    expect(data.mbti_profile).toBeNull();
    expect(data.calendar_connections).toEqual([]);
  });

  it('returns the same user when the same provider identity logs in again', async () => {
    const first = await loginNewUser(ctx.app);
    const second = await loginNewUser(ctx.app, {
      providerUserId: first.providerUserId,
    });

    expect(second.userId).toBe(first.userId);
    expect(second.sessionId).not.toBe(first.sessionId);
  });

  it('rejects requests without a bearer token using the error envelope', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/v1/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: expect.objectContaining({
        code: 'UNAUTHORIZED',
        message: 'Missing Bearer token.',
        path: '/v1/me',
      }),
    });
  });

  it('rejects a token whose payload was tampered with', async () => {
    const user = await loginNewUser(ctx.app);
    const victim = await loginNewUser(ctx.app);
    const [header, payload, signature] = user.accessToken.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...claims, sub: victim.userId }),
    ).toString('base64url');

    const response = await authed(
      ctx.app,
      { accessToken: `${header}.${forgedPayload}.${signature}` },
      { method: 'GET', url: '/v1/me' },
    );

    expect(response.statusCode).toBe(401);
  });

  it('rejects social login payloads that fail validation', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/social/login',
      payload: {
        provider: 'MYSPACE',
        provider_payload: { provider_user_id: 'x' },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rotates refresh tokens and rejects reuse of the previous one', async () => {
    const user = await loginNewUser(ctx.app);

    const refreshed = await expectStatus(
      ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: {
          refresh_token: user.refreshToken,
          session_id: user.sessionId,
          device_id: user.deviceId,
        },
      }),
      201,
    );
    const { tokens } = refreshed.json().data;

    expect(tokens.session_id).toBe(user.sessionId);
    expect(tokens.refresh_token).not.toBe(user.refreshToken);
    await expectStatus(
      authed(ctx.app, { accessToken: tokens.access_token }, {
        method: 'GET',
        url: '/v1/me',
      }),
      200,
    );

    const reused = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: {
        refresh_token: user.refreshToken,
        session_id: user.sessionId,
      },
    });

    expect(reused.statusCode).toBe(401);
    expect(reused.json().error.message).toBe('Refresh token is invalid.');
  });

  it('rejects a refresh from a different device than the session was created on', async () => {
    const user = await loginNewUser(ctx.app);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: {
        refresh_token: user.refreshToken,
        session_id: user.sessionId,
        device_id: 'some-other-device',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toBe('Device does not match session.');
  });

  it('revokes only the current session on logout', async () => {
    const user = await loginNewUser(ctx.app);
    const otherDevice = await loginNewUser(ctx.app, {
      providerUserId: user.providerUserId,
    });

    await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: '/v1/auth/logout',
        payload: { refresh_token: user.refreshToken, logout_all_devices: false },
      }),
      201,
    );

    const afterLogout = await authed(ctx.app, user, {
      method: 'GET',
      url: '/v1/me',
    });
    expect(afterLogout.statusCode).toBe(401);
    expect(afterLogout.json().error.message).toBe('Session is invalid.');

    await expectStatus(
      authed(ctx.app, otherDevice, { method: 'GET', url: '/v1/me' }),
      200,
    );
  });

  it('revokes every session of the user when logging out of all devices', async () => {
    const user = await loginNewUser(ctx.app);
    const otherDevice = await loginNewUser(ctx.app, {
      providerUserId: user.providerUserId,
    });

    await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: '/v1/auth/logout',
        payload: { logout_all_devices: true },
      }),
      201,
    );

    for (const session of [user, otherDevice]) {
      const response = await authed(ctx.app, session, {
        method: 'GET',
        url: '/v1/me',
      });
      expect(response.statusCode).toBe(401);
    }

    const refreshAfterLogout = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: {
        refresh_token: otherDevice.refreshToken,
        session_id: otherDevice.sessionId,
      },
    });
    expect(refreshAfterLogout.statusCode).toBe(401);
  });

  it('does not let a user log out a session that belongs to someone else', async () => {
    const owner = await loginNewUser(ctx.app);
    const attacker = await loginNewUser(ctx.app);

    const response = await authed(ctx.app, attacker, {
      method: 'POST',
      url: '/v1/auth/logout',
      payload: { refresh_token: owner.refreshToken, logout_all_devices: false },
    });

    // 공격자 자신의 세션 기준으로 처리되므로 남의 refresh token은 거부된다.
    expect(response.statusCode).toBe(401);
    await expectStatus(
      authed(ctx.app, owner, { method: 'GET', url: '/v1/me' }),
      200,
    );
  });
});
