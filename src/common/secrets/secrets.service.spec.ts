import { ConfigService } from '@nestjs/config';

import { SecretsService } from './secrets.service';

function createService(encryptionKey?: string) {
  return new SecretsService({
    get: jest.fn((key: string) =>
      key === 'ENCRYPTION_KEY' ? encryptionKey : undefined,
    ),
  } as unknown as ConfigService);
}

describe('SecretsService', () => {
  const tokens = JSON.stringify({
    access_token: 'ya29.access',
    refresh_token: '1//refresh',
    expiry_date: 1767225600000,
  });

  it('round-trips a value through AES-256-GCM', () => {
    const service = createService('unit-test-encryption-key-32bytes');

    const encrypted = service.encrypt(tokens);

    expect(encrypted).not.toContain('ya29');
    expect(encrypted.split(':')).toHaveLength(3);
    expect(service.decrypt(encrypted)).toBe(tokens);
  });

  it('uses a fresh IV for every encryption', () => {
    const service = createService('unit-test-encryption-key-32bytes');

    expect(service.encrypt(tokens)).not.toBe(service.encrypt(tokens));
  });

  it('returns legacy plaintext values unchanged', () => {
    expect(createService('k').decrypt('legacy-plain-token')).toBe(
      'legacy-plain-token',
    );
  });

  it('refuses ciphertext that was tampered with', () => {
    const service = createService('unit-test-encryption-key-32bytes');
    const [iv, tag, content] = service.encrypt(tokens).split(':');
    const flipped = (parseInt(content[0], 16) ^ 1).toString(16) + content.slice(1);

    expect(() => service.decrypt(`${iv}:${tag}:${flipped}`)).toThrow(
      'DECRYPTION_FAILED',
    );
  });

  it('cannot decrypt with a different key', () => {
    const encrypted = createService('key-one-key-one-key-one-key-one!').encrypt(tokens);

    expect(() =>
      createService('key-two-key-two-key-two-key-two!').decrypt(encrypted),
    ).toThrow('DECRYPTION_FAILED');
  });

  it('falls back to the development key when ENCRYPTION_KEY is unset', () => {
    const withoutKey = createService(undefined);
    const withDevKey = createService('dev-fallback-secret-key-32bytes!');

    expect(withDevKey.decrypt(withoutKey.encrypt(tokens))).toBe(tokens);
  });
});
