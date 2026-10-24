export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const required = ['DATABASE_URL'];
  const missing = required.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  if (config.NODE_ENV === 'production') {
    const placeholders = [
      'dev-access-secret-change-me',
      'dev-fallback-secret-key-32bytes!',
      'change-me-access-secret',
      'change-me-with-openssl-rand-base64-32',
    ];

    for (const key of ['AUTH_ACCESS_TOKEN_SECRET', 'ENCRYPTION_KEY']) {
      const value = config[key];
      if (
        typeof value !== 'string' ||
        value.trim().length === 0 ||
        Buffer.byteLength(value, 'utf8') < 32 ||
        placeholders.includes(value.trim())
      ) {
        throw new Error(
          `${key} must be a nonempty secret of at least 32 UTF-8 bytes and not a fallback or placeholder in production.`,
        );
      }
    }

    for (const key of [
      'AUTH_ENABLE_DEV_IDENTITY_BRIDGE',
      'CALENDAR_ENABLE_DEV_OAUTH_BRIDGE',
    ]) {
      if (config[key] !== 'false') {
        throw new Error(`${key} must be explicitly set to false in production.`);
      }
    }
  }

  return config;
}
