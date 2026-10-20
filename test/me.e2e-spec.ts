import {
  authed,
  createE2eApp,
  expectStatus,
  loginOnboardedUser,
  type E2eApp,
} from './support/e2e-app';

describe('Me (e2e)', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('updates locale and timezone and merges notification preferences', async () => {
    const user = await loginOnboardedUser(ctx.app);

    await expectStatus(
      authed(ctx.app, user, {
        method: 'PATCH',
        url: '/v1/me/preferences',
        payload: { notification_prefs: { enabled: true } },
      }),
      200,
    );
    const updated = await expectStatus(
      authed(ctx.app, user, {
        method: 'PATCH',
        url: '/v1/me/preferences',
        payload: {
          locale: 'en-US',
          timezone: 'America/New_York',
          notification_prefs: { quiet_hours: { start: '22:00', end: '07:30' } },
        },
      }),
      200,
    );

    expect(updated.json().data).toEqual({
      locale: 'en-US',
      timezone: 'America/New_York',
      notification_prefs: {
        enabled: true,
        quiet_hours: { start: '22:00', end: '07:30' },
      },
    });

    const me = await expectStatus(
      authed(ctx.app, user, { method: 'GET', url: '/v1/me' }),
      200,
    );
    expect(me.json().data.user).toMatchObject({
      locale: 'en-US',
      timezone: 'America/New_York',
    });
  });

  it('rejects a timezone that is not a valid IANA zone', async () => {
    const user = await loginOnboardedUser(ctx.app);

    const response = await authed(ctx.app, user, {
      method: 'PATCH',
      url: '/v1/me/preferences',
      payload: { timezone: 'Mars/Olympus_Mons' },
    });

    expect(response.statusCode).toBe(400);

    // 잘못된 값이 저장되면 이후 날짜 계산이 전부 500으로 깨진다.
    await expectStatus(
      authed(ctx.app, user, { method: 'GET', url: '/v1/home' }),
      200,
    );
  });

  it('rejects quiet hours that are not HH:MM', async () => {
    const user = await loginOnboardedUser(ctx.app);

    const response = await authed(ctx.app, user, {
      method: 'PATCH',
      url: '/v1/me/preferences',
      payload: { notification_prefs: { quiet_hours: { start: '10pm', end: '7am' } } },
    });

    expect(response.statusCode).toBe(400);
  });

  it('serves the app bootstrap payload for an onboarded user', async () => {
    const user = await loginOnboardedUser(ctx.app, 'ENTJ');

    const response = await expectStatus(
      authed(ctx.app, user, { method: 'GET', url: '/v1/app/bootstrap' }),
      200,
    );

    expect(response.json().data).toMatchObject({
      user: { id: user.userId },
    });
  });

  it('reports healthy without authentication', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/v1/health' });

    expect(response.statusCode).toBe(200);
  });
});
