import { validateEnv } from './env.validation';

const productionConfig = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://test:test@localhost/test',
  AUTH_ACCESS_TOKEN_SECRET: 'test-access-key-0123456789abcdef01',
  ENCRYPTION_KEY: 'test-encryption-0123456789abcdef01',
  AUTH_ENABLE_DEV_IDENTITY_BRIDGE: 'false',
  CALENDAR_ENABLE_DEV_OAUTH_BRIDGE: 'false',
};

describe('validateEnv', () => {
  it('accepts valid production configuration without changing it', () => {
    expect(validateEnv(productionConfig)).toBe(productionConfig);
  });

  describe.each(['AUTH_ACCESS_TOKEN_SECRET', 'ENCRYPTION_KEY'])('%s', (key) => {
    it.each([
      undefined,
      null,
      '',
      ' '.repeat(32),
      'a'.repeat(31),
      'é'.repeat(15),
      1234567890,
      false,
    ])('rejects missing, empty or weak production values: %p', (value) => {
      expect(() => validateEnv({ ...productionConfig, [key]: value })).toThrow(key);
    });

    it.each([
      'dev-access-secret-change-me',
      'dev-fallback-secret-key-32bytes!',
      'change-me-access-secret',
      'change-me-with-openssl-rand-base64-32',
      '  change-me-with-openssl-rand-base64-32  ',
    ])('rejects known fallback or sample placeholders: %p', (value) => {
      expect(() => validateEnv({ ...productionConfig, [key]: value })).toThrow(key);
    });

    it.each(['a'.repeat(32), 'é'.repeat(16)])(
      'accepts secrets at the 32 UTF-8 byte boundary: %p',
      (value) => {
        const config = { ...productionConfig, [key]: value };
        expect(validateEnv(config)).toBe(config);
      },
    );
  });

  it('does not accept the stale JWT_ACCESS_SECRET as the access secret', () => {
    const config: Record<string, unknown> = {
      ...productionConfig,
      JWT_ACCESS_SECRET: productionConfig.AUTH_ACCESS_TOKEN_SECRET,
    };
    delete config.AUTH_ACCESS_TOKEN_SECRET;

    expect(() => validateEnv(config)).toThrow('AUTH_ACCESS_TOKEN_SECRET');
  });

  describe.each([
    'AUTH_ENABLE_DEV_IDENTITY_BRIDGE',
    'CALENDAR_ENABLE_DEV_OAUTH_BRIDGE',
  ])('%s', (key) => {
    it.each([undefined, null, '', 'true', 'FALSE', '0', false, 0])(
      'rejects production values other than explicit string false: %p',
      (value) => {
        expect(() => validateEnv({ ...productionConfig, [key]: value })).toThrow(key);
      },
    );
  });

  it.each(['development', 'test', undefined])(
    'preserves existing behavior outside production: %p',
    (nodeEnv) => {
      const config = { NODE_ENV: nodeEnv, DATABASE_URL: productionConfig.DATABASE_URL };
      expect(validateEnv(config)).toBe(config);

      const devConfig = {
        ...config,
        AUTH_ACCESS_TOKEN_SECRET: 'dev-access-secret-change-me',
        ENCRYPTION_KEY: 'dev-fallback-secret-key-32bytes!',
        AUTH_ENABLE_DEV_IDENTITY_BRIDGE: 'true',
        CALENDAR_ENABLE_DEV_OAUTH_BRIDGE: 'true',
      };
      expect(validateEnv(devConfig)).toBe(devConfig);
    },
  );

  it.each(['production', 'development', 'test', undefined])(
    'still requires DATABASE_URL in %p',
    (nodeEnv) => {
      const config: Record<string, unknown> = { ...productionConfig, NODE_ENV: nodeEnv };
      delete config.DATABASE_URL;

      expect(() => validateEnv(config)).toThrow('DATABASE_URL');
    },
  );

  it('does not include secret values in validation errors', () => {
    const secret = 'private-short-secret';

    expect(() => validateEnv({ ...productionConfig, AUTH_ACCESS_TOKEN_SECRET: secret }))
      .toThrow('AUTH_ACCESS_TOKEN_SECRET');
    try {
      validateEnv({ ...productionConfig, AUTH_ACCESS_TOKEN_SECRET: secret });
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
