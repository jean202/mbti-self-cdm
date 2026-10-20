import { Logger } from '@nestjs/common';

import { DEV_ACCESS_TOKEN_SECRET } from '../../modules/auth/auth-token.service';

// .env.example에 적힌 자리표시자. 그대로 복사해 배포하면 공개된 값으로 토큰이 서명된다.
const PLACEHOLDER_SECRETS = new Set([
  DEV_ACCESS_TOKEN_SECRET,
  'change-me-with-openssl-rand-base64-32',
]);

// SecretsService가 ENCRYPTION_KEY 없이 쓰는 값.
const DEV_ENCRYPTION_KEY = 'dev-fallback-secret-key-32bytes!';

const logger = new Logger('EnvValidation');

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const required = ['DATABASE_URL'];
  const missing = required.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  if (config.NODE_ENV === 'production') {
    validateProductionEnv(config);
  }

  return config;
}

function validateProductionEnv(config: Record<string, unknown>): void {
  const secret = readString(config.AUTH_ACCESS_TOKEN_SECRET);

  if (!secret || PLACEHOLDER_SECRETS.has(secret)) {
    throw new Error(
      'AUTH_ACCESS_TOKEN_SECRET must be set to a private random value in production ' +
        '(for example: openssl rand -base64 32).',
    );
  }

  if (readString(config.AUTH_ENABLE_DEV_IDENTITY_BRIDGE) === 'true') {
    logger.warn(
      'AUTH_ENABLE_DEV_IDENTITY_BRIDGE=true in production: anyone can sign in with only a provider_user_id.',
    );
  }

  const encryptionKey = readString(config.ENCRYPTION_KEY);

  // 이미 개발 키로 암호화해 저장한 캘린더 자격이 있을 수 있어 기동은 막지 않는다.
  if (
    !encryptionKey ||
    PLACEHOLDER_SECRETS.has(encryptionKey) ||
    encryptionKey === DEV_ENCRYPTION_KEY
  ) {
    logger.warn(
      'ENCRYPTION_KEY is unset, blank or a known placeholder in production; calendar credentials are encrypted with a publicly known key.',
    );
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}
