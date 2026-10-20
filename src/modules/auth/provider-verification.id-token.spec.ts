import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider } from '@prisma/client';
import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto';

import type { SocialLoginDto } from './dto/social-login.dto';
import { ProviderVerificationService } from './provider-verification.service';

// 실제 RSA 키로 서명한 id_token을 만들고, discovery/JWKS 응답은 fetch를 가로채 돌려준다.

const GOOGLE_DISCOVERY = 'https://accounts.google.com/.well-known/openid-configuration';
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const APPLE_DISCOVERY = 'https://appleid.apple.com/.well-known/openid-configuration';
const APPLE_JWKS = 'https://appleid.apple.com/auth/keys';

function createKey(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

  return {
    kid,
    privateKey,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' },
  };
}

const googleKey = createKey('google-key-1');
const appleKey = createKey('apple-key-1');
const strangerKey = createKey('google-key-1');

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function idToken(
  payload: Record<string, unknown>,
  options: { privateKey?: KeyObject; header?: Record<string, unknown> } = {},
) {
  const header = { alg: 'RS256', kid: googleKey.kid, typ: 'JWT', ...options.header };
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(signingInput),
    options.privateKey ?? googleKey.privateKey,
  ).toString('base64url');

  return `${signingInput}.${signature}`;
}

function googleClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: 'https://accounts.google.com',
    aud: 'google-ios-client',
    sub: '109876543210',
    email: 'Jean@Example.com',
    name: 'Jean',
    exp: Math.floor(Date.now() / 1000) + 600,
    ...overrides,
  };
}

function login(
  token: string | undefined,
  provider: AuthProvider = AuthProvider.GOOGLE,
  extra: Partial<SocialLoginDto['provider_payload']> = {},
): SocialLoginDto {
  return {
    provider,
    provider_payload: { id_token: token, ...extra },
    device: { device_id: 'device-1', platform: 'IOS', app_version: '1.0.0' },
  };
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

describe('ProviderVerificationService id_token verification', () => {
  const originalFetch = globalThis.fetch;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  let env: Record<string, string | undefined>;
  let service: ProviderVerificationService;
  let jwks: Record<string, unknown[]>;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
    env = {
      AUTH_GOOGLE_CLIENT_IDS: 'google-ios-client, google-android-client',
      AUTH_APPLE_CLIENT_IDS: 'com.example.app',
    };
    jwks = {
      [GOOGLE_JWKS]: [googleKey.jwk],
      [APPLE_JWKS]: [appleKey.jwk],
    };
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);

      if (url === GOOGLE_DISCOVERY) {
        return jsonResponse({ issuer: 'https://accounts.google.com', jwks_uri: GOOGLE_JWKS });
      }
      if (url === APPLE_DISCOVERY) {
        return jsonResponse({ issuer: 'https://appleid.apple.com', jwks_uri: APPLE_JWKS });
      }
      if (url in jwks) {
        return jsonResponse({ keys: jwks[url] });
      }

      throw new Error(`unexpected fetch ${url}`);
    });
    service = new ProviderVerificationService({
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts a correctly signed Google id_token and normalizes the identity', async () => {
    const result = await service.verify(login(idToken(googleClaims())));

    expect(result).toMatchObject({
      provider: AuthProvider.GOOGLE,
      providerUserId: '109876543210',
      providerEmail: 'jean@example.com',
      providerDisplayName: 'Jean',
    });
    expect(result.rawProfileJson).toMatchObject({
      header: { kid: 'google-key-1' },
      payload: { sub: '109876543210' },
    });
  });

  it('accepts any configured client id, including one inside an audience array', async () => {
    await expect(
      service.verify(login(idToken(googleClaims({ aud: 'google-android-client' })))),
    ).resolves.toBeDefined();
    await expect(
      service.verify(
        login(idToken(googleClaims({ aud: ['other-app', 'google-ios-client'] }))),
      ),
    ).resolves.toBeDefined();
  });

  it('accepts the legacy Google issuer without scheme', async () => {
    await expect(
      service.verify(login(idToken(googleClaims({ iss: 'accounts.google.com' })))),
    ).resolves.toBeDefined();
  });

  it('verifies Apple tokens against Apple keys and client ids', async () => {
    const token = idToken(
      {
        iss: 'https://appleid.apple.com',
        aud: 'com.example.app',
        sub: '001234.abcd',
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      { privateKey: appleKey.privateKey, header: { kid: appleKey.kid } },
    );

    await expect(service.verify(login(token, AuthProvider.APPLE))).resolves.toMatchObject({
      provider: AuthProvider.APPLE,
      providerUserId: '001234.abcd',
    });
  });

  it.each([
    ['issued for another app', { aud: 'someone-elses-client' }, 'Invalid GOOGLE token audience.'],
    ['from another issuer', { iss: 'https://evil.example.com' }, 'Invalid GOOGLE token issuer.'],
    ['expired', { exp: Math.floor(Date.now() / 1000) - 1 }, 'GOOGLE id_token expired.'],
    ['without exp', { exp: undefined }, 'GOOGLE id_token expired.'],
    ['without sub', { sub: undefined }, 'Invalid token sub claim.'],
    ['with a non-string audience', { aud: 42 }, 'Invalid token audience.'],
  ])('rejects a token %s', async (_label, overrides, message) => {
    await expect(service.verify(login(idToken(googleClaims(overrides))))).rejects.toThrow(
      new UnauthorizedException(message),
    );
  });

  it('rejects a Google token presented as an Apple login', async () => {
    jwks[APPLE_JWKS] = [{ ...googleKey.jwk }];

    await expect(
      service.verify(login(idToken(googleClaims()), AuthProvider.APPLE)),
    ).rejects.toThrow('Invalid APPLE token issuer.');
  });

  it('rejects a token signed by a key the provider never published', async () => {
    const forged = idToken(googleClaims(), { privateKey: strangerKey.privateKey });

    await expect(service.verify(login(forged))).rejects.toThrow(
      'Invalid id_token signature.',
    );
  });

  it('rejects a token whose claims were edited after signing', async () => {
    const [header, , signature] = idToken(googleClaims()).split('.');
    const edited = `${header}.${encode(googleClaims({ sub: 'victim' }))}.${signature}`;

    await expect(service.verify(login(edited))).rejects.toThrow(
      'Invalid id_token signature.',
    );
  });

  it.each([
    ['alg none', { alg: 'none' }, 'Unsupported id_token signing algorithm.'],
    ['HS256 (key confusion)', { alg: 'HS256' }, 'Unsupported id_token signing algorithm.'],
    ['no kid', { kid: undefined }, 'Missing id_token kid.'],
    ['an unknown kid', { kid: 'rotated-away' }, 'Provider signing key was not found.'],
  ])('rejects a header with %s', async (_label, header, message) => {
    await expect(
      service.verify(login(idToken(googleClaims(), { header }))),
    ).rejects.toThrow(message);
  });

  it.each(['not-a-jwt', 'a.b', '!!!.???.***'])(
    'rejects the malformed id_token %p',
    async (token) => {
      await expect(service.verify(login(token))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    },
  );

  describe('nonce', () => {
    it('accepts a matching nonce', async () => {
      const token = idToken(googleClaims({ nonce: 'n-123' }));

      await expect(
        service.verify(login(token, AuthProvider.GOOGLE, { nonce: 'n-123' })),
      ).resolves.toBeDefined();
    });

    it.each([
      ['a different nonce', { nonce: 'n-999' }],
      ['no nonce in the token', {}],
    ])('rejects %s', async (_label, claims) => {
      const token = idToken(googleClaims(claims));

      await expect(
        service.verify(login(token, AuthProvider.GOOGLE, { nonce: 'n-123' })),
      ).rejects.toThrow('Invalid GOOGLE token nonce.');
    });
  });

  it('refuses to verify when the provider client ids are not configured', async () => {
    env.AUTH_GOOGLE_CLIENT_IDS = ' , ';

    await expect(service.verify(login(idToken(googleClaims())))).rejects.toMatchObject({
      response: { code: 'SOCIAL_PROVIDER_NOT_CONFIGURED' },
    });
  });

  it('caches discovery and JWKS between logins', async () => {
    await service.verify(login(idToken(googleClaims())));
    await service.verify(login(idToken(googleClaims({ sub: 'other' }))));

    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual([
      GOOGLE_DISCOVERY,
      GOOGLE_JWKS,
    ]);
  });

  it('reports provider outages as service unavailable', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({}, false));

    await expect(service.verify(login(idToken(googleClaims())))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('reports malformed discovery and JWKS documents as service unavailable', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ issuer: 'x' }));
    await expect(service.verify(login(idToken(googleClaims())))).rejects.toThrow(
      'Provider OpenID configuration is invalid.',
    );

    jwks[GOOGLE_JWKS] = 'not-a-list' as unknown as unknown[];
    await expect(service.verify(login(idToken(googleClaims())))).rejects.toThrow(
      'Provider JWKS is invalid.',
    );
  });

  it('wraps network errors so internals do not leak to the client', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND accounts.google.com'));

    await expect(service.verify(login(idToken(googleClaims())))).rejects.toThrow(
      new ServiceUnavailableException('Provider verification failed.'),
    );
  });

  describe('without an id_token', () => {
    it('explains that authorization code exchange is not implemented', async () => {
      await expect(
        service.verify(login(undefined, AuthProvider.GOOGLE, { authorization_code: 'code' })),
      ).rejects.toMatchObject({
        response: { code: 'AUTH_CODE_EXCHANGE_NOT_IMPLEMENTED' },
      });
    });

    it('accepts the dev identity bridge only when it is enabled', async () => {
      env.AUTH_ENABLE_DEV_IDENTITY_BRIDGE = 'true';
      await expect(
        service.verify(
          login(undefined, AuthProvider.NAVER, { provider_user_id: '  naver-1  ' }),
        ),
      ).resolves.toMatchObject({
        provider: AuthProvider.NAVER,
        providerUserId: 'naver-1',
        rawProfileJson: { mode: 'dev-identity-bridge' },
      });

      env.AUTH_ENABLE_DEV_IDENTITY_BRIDGE = 'false';
      await expect(
        service.verify(login(undefined, AuthProvider.NAVER, { provider_user_id: 'naver-1' })),
      ).rejects.toThrow(new BadRequestException('provider_payload.id_token is required.'));
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('turns the bridge off by default in production and on elsewhere', async () => {
      const bridgeLogin = login(undefined, AuthProvider.KAKAO, { provider_user_id: '12345' });

      env.NODE_ENV = 'production';
      await expect(service.verify(bridgeLogin)).rejects.toThrow(
        new BadRequestException('provider_payload.id_token is required.'),
      );

      env.NODE_ENV = 'production';
      env.AUTH_ENABLE_DEV_IDENTITY_BRIDGE = '  ';
      await expect(service.verify(bridgeLogin)).rejects.toBeInstanceOf(BadRequestException);

      env.NODE_ENV = 'production';
      env.AUTH_ENABLE_DEV_IDENTITY_BRIDGE = 'true';
      await expect(service.verify(bridgeLogin)).resolves.toMatchObject({
        providerUserId: '12345',
      });

      env.NODE_ENV = 'development';
      env.AUTH_ENABLE_DEV_IDENTITY_BRIDGE = undefined;
      await expect(service.verify(bridgeLogin)).resolves.toMatchObject({
        providerUserId: '12345',
      });
    });

    it('uses the lowercased email as the bridge identity when no user id is sent', async () => {
      env.AUTH_ENABLE_DEV_IDENTITY_BRIDGE = 'true';

      await expect(
        service.verify(
          login(undefined, AuthProvider.GOOGLE, { provider_email: ' Dev@Example.com ' }),
        ),
      ).resolves.toMatchObject({
        providerUserId: 'dev@example.com',
        providerEmail: 'dev@example.com',
      });
    });

    it('requires some identity even in bridge mode', async () => {
      env.AUTH_ENABLE_DEV_IDENTITY_BRIDGE = 'true';

      await expect(service.verify(login(undefined))).rejects.toMatchObject({
        response: { code: 'INVALID_PROVIDER_PAYLOAD' },
      });
    });
  });
});
