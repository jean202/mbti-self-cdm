import {
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';

import { AuthTokenService } from './auth-token.service';

function createService(env: Record<string, string> = {}) {
  return new AuthTokenService({
    get: jest.fn((key: string) => env[key]),
  } as unknown as ConfigService);
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(header: unknown, payload: unknown, secret: string): string {
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');

  return `${unsigned}.${signature}`;
}

describe('AuthTokenService', () => {
  const env = {
    AUTH_ACCESS_TOKEN_SECRET: 'unit-test-secret',
    AUTH_TOKEN_ISSUER: 'unit-test-issuer',
  };

  afterEach(() => {
    jest.useRealTimers();
  });

  it('issues an HS256 access token that verifies back to the same claims', () => {
    const service = createService(env);

    const issued = service.issueAccessToken({
      userId: 'user-1',
      sessionId: 'session-1',
      deviceId: 'device-1',
    });
    const claims = service.verifyAccessToken(issued.token);

    expect(issued.expiresIn).toBe(3600);
    expect(claims).toEqual(issued.claims);
    expect(claims).toMatchObject({
      sub: 'user-1',
      sid: 'session-1',
      did: 'device-1',
      type: 'access',
      iss: 'unit-test-issuer',
    });
    expect(claims.exp - claims.iat).toBe(3600);
    expect(JSON.parse(Buffer.from(issued.token.split('.')[0], 'base64url').toString())).toEqual({
      alg: 'HS256',
      typ: 'JWT',
    });
  });

  it('gives every access token a unique jti', () => {
    const service = createService(env);
    const input = { userId: 'user-1', sessionId: 'session-1' };

    expect(service.issueAccessToken(input).claims.jti).not.toBe(
      service.issueAccessToken(input).claims.jti,
    );
  });

  it('rejects a token signed with a different secret', () => {
    const issuer = createService({ ...env, AUTH_ACCESS_TOKEN_SECRET: 'other-secret' });
    const verifier = createService(env);
    const { token } = issuer.issueAccessToken({ userId: 'u', sessionId: 's' });

    expect(() => verifier.verifyAccessToken(token)).toThrow(UnauthorizedException);
  });

  it('rejects a token whose payload was changed after signing', () => {
    const service = createService(env);
    const { token } = service.issueAccessToken({ userId: 'u', sessionId: 's' });
    const [header, payload, signature] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());

    expect(() =>
      service.verifyAccessToken(
        `${header}.${encode({ ...claims, sub: 'admin' })}.${signature}`,
      ),
    ).toThrow('Invalid access token.');
  });

  it('rejects tokens from another issuer even with a valid signature', () => {
    const service = createService(env);
    const now = Math.floor(Date.now() / 1000);
    const token = sign(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'u', sid: 's', jti: 'j', type: 'access', iss: 'someone-else', iat: now, exp: now + 60 },
      env.AUTH_ACCESS_TOKEN_SECRET,
    );

    expect(() => service.verifyAccessToken(token)).toThrow(
      'Invalid access token issuer.',
    );
  });

  it('rejects expired tokens', () => {
    jest.useFakeTimers({ now: Date.parse('2026-01-01T00:00:00Z') });
    const service = createService({ ...env, AUTH_ACCESS_TOKEN_TTL_SECONDS: '60' });
    const { token } = service.issueAccessToken({ userId: 'u', sessionId: 's' });

    jest.setSystemTime(Date.parse('2026-01-01T00:00:59Z'));
    expect(service.verifyAccessToken(token).sub).toBe('u');

    jest.setSystemTime(Date.parse('2026-01-01T00:01:00Z'));
    expect(() => service.verifyAccessToken(token)).toThrow('Access token expired.');
  });

  it('rejects signed tokens that are not access tokens or lack required claims', () => {
    const service = createService(env);
    const now = Math.floor(Date.now() / 1000);
    const base = { sub: 'u', sid: 's', jti: 'j', type: 'access', iss: env.AUTH_TOKEN_ISSUER, iat: now, exp: now + 60 };

    for (const payload of [
      { ...base, type: 'refresh' },
      { ...base, sub: 42 },
      { ...base, sid: undefined },
      { ...base, jti: null },
      { ...base, exp: 'never' },
    ]) {
      const token = sign({ alg: 'HS256' }, payload, env.AUTH_ACCESS_TOKEN_SECRET);

      expect(() => service.verifyAccessToken(token)).toThrow(UnauthorizedException);
    }
  });

  it.each(['', 'a.b', 'a.b.c.d', 'not-a-jwt'])(
    'rejects the malformed token %p',
    (token) => {
      expect(() => createService(env).verifyAccessToken(token)).toThrow(
        UnauthorizedException,
      );
    },
  );

  it('rejects a correctly signed payload that is not JSON', () => {
    const header = encode({ alg: 'HS256' });
    const payload = Buffer.from('not json').toString('base64url');
    const signature = createHmac('sha256', env.AUTH_ACCESS_TOKEN_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url');

    expect(() =>
      createService(env).verifyAccessToken(`${header}.${payload}.${signature}`),
    ).toThrow('Invalid access token.');
  });

  it('issues random refresh tokens and stores only a stable hash', () => {
    const service = createService(env);
    const first = service.issueRefreshToken();
    const second = service.issueRefreshToken();

    expect(first.token).not.toBe(second.token);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(first.hash).not.toContain(first.token);
    expect(service.hashRefreshToken(first.token)).toBe(first.hash);
    expect(first.expiresIn).toBe(60 * 60 * 24 * 30);
  });

  it('reads TTLs from configuration', () => {
    const service = createService({
      AUTH_ACCESS_TOKEN_TTL_SECONDS: '900',
      AUTH_REFRESH_TOKEN_TTL_SECONDS: '86400',
    });

    expect(service.getAccessTokenTtlSeconds()).toBe(900);
    expect(service.getRefreshTokenTtlSeconds()).toBe(86400);
  });

  it.each(['0', '-5', 'abc'])('refuses a non-positive TTL of %p', (value) => {
    const service = createService({ AUTH_ACCESS_TOKEN_TTL_SECONDS: value });

    expect(() => service.getAccessTokenTtlSeconds()).toThrow(
      InternalServerErrorException,
    );
  });

  it('refuses a blank signing secret', () => {
    const service = createService({ AUTH_ACCESS_TOKEN_SECRET: '   ' });

    expect(() =>
      service.issueAccessToken({ userId: 'u', sessionId: 's' }),
    ).toThrow('AUTH_ACCESS_TOKEN_SECRET must not be empty.');
  });
});
