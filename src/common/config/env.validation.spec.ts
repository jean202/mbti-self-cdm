import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('accepts a config with DATABASE_URL', () => {
    const config = { DATABASE_URL: 'postgresql://x', OTHER: '1' };

    expect(validateEnv(config)).toBe(config);
  });

  it.each([{}, { DATABASE_URL: '' }])('rejects %p', (config) => {
    expect(() => validateEnv(config)).toThrow(
      'Missing required environment variables: DATABASE_URL',
    );
  });
});
