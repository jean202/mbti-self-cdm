import { Logger } from '@nestjs/common';

import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('accepts a config with DATABASE_URL', () => {
    const config = { DATABASE_URL: 'postgresql://x', OTHER: '1' };

    expect(validateEnv(config)).toBe(config);
  });

  it.each([{}, { DATABASE_URL: '' }])('rejects %p', (config) => {
    expect(() => validateEnv(config)).toThrow(
      'Missing required environment variables: DATABASE_URL',
    );
  });

  describe('in production', () => {
    const production = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://x',
      AUTH_ACCESS_TOKEN_SECRET: 'q3Yl7m0Vb2kq9Jt8eW1sR4uZx6Hc5Np0',
      ENCRYPTION_KEY: 'k8Pz2Lr5Tq1Wv7Yb4Nc9Hd3Fs6Jm0Xa2',
    };

    it('accepts private secrets', () => {
      expect(validateEnv(production)).toBe(production);
      expect(warn).not.toHaveBeenCalled();
    });

    it.each([
      ['missing', undefined],
      ['blank', '   '],
      ['the code default', 'dev-access-secret-change-me'],
      ['the .env.example placeholder', 'change-me-with-openssl-rand-base64-32'],
    ])('refuses to start with a %s access token secret', (_label, secret) => {
      expect(() =>
        validateEnv({ ...production, AUTH_ACCESS_TOKEN_SECRET: secret }),
      ).toThrow('AUTH_ACCESS_TOKEN_SECRET must be set to a private random value in production');
    });

    it('warns but starts when the dev identity bridge is explicitly enabled', () => {
      expect(() =>
        validateEnv({ ...production, AUTH_ENABLE_DEV_IDENTITY_BRIDGE: 'true' }),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('AUTH_ENABLE_DEV_IDENTITY_BRIDGE=true in production'),
      );
    });

    it.each([
      ['missing', undefined],
      ['the .env.example placeholder', 'change-me-with-openssl-rand-base64-32'],
      ['the SecretsService fallback', 'dev-fallback-secret-key-32bytes!'],
    ])('warns but starts with a %s encryption key', (_label, encryptionKey) => {
      expect(() =>
        validateEnv({ ...production, ENCRYPTION_KEY: encryptionKey }),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('ENCRYPTION_KEY'));
    });
  });

  it('does not require production secrets outside production', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://x' }),
    ).not.toThrow();
    expect(() => validateEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://x' })).not.toThrow();
  });
});
