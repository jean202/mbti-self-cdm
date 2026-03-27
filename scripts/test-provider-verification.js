const assert = require('node:assert/strict');
const {
  createPrivateKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} = require('node:crypto');

const {
  ProviderVerificationService,
} = require('../dist/modules/auth/provider-verification.service');

async function main() {
  await testGoogleIdTokenVerification();
  await testNonceMismatch();
  await testDevBridgeFallback();

  console.log(
    JSON.stringify(
      {
        ok: true,
        tests: [
          'google-id-token-verification',
          'nonce-mismatch',
          'dev-identity-bridge',
        ],
      },
      null,
      2,
    ),
  );
}

async function testGoogleIdTokenVerification() {
  const issuer = 'https://accounts.google.com';
  const clientId = 'google-client-id';
  const kid = 'google-test-key';
  const nonce = 'nonce-123';
  const { privateKey, publicJwk } = createSigningKey(kid);
  const idToken = createIdToken({
    header: { alg: 'RS256', kid },
    payload: {
      iss: issuer,
      aud: clientId,
      sub: 'google-user-123',
      email: 'User@example.com',
      name: 'Google User',
      nonce,
      exp: Math.floor(Date.now() / 1000) + 60 * 10,
    },
    privateKey,
  });

  const service = createService({
    AUTH_ENABLE_DEV_IDENTITY_BRIDGE: 'false',
    AUTH_GOOGLE_CLIENT_IDS: clientId,
  });
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    if (url === 'https://accounts.google.com/.well-known/openid-configuration') {
      return jsonResponse({
        issuer,
        jwks_uri: 'https://test.example.com/google/jwks',
      });
    }

    if (url === 'https://test.example.com/google/jwks') {
      return jsonResponse({
        keys: [publicJwk],
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const result = await service.verify({
      provider: 'GOOGLE',
      provider_payload: {
        id_token: idToken,
        nonce,
      },
      device: {
        device_id: randomUUID(),
        platform: 'IOS',
        app_version: '0.1.0',
      },
    });

    assert.equal(result.provider, 'GOOGLE');
    assert.equal(result.providerUserId, 'google-user-123');
    assert.equal(result.providerEmail, 'user@example.com');
    assert.equal(result.providerDisplayName, 'Google User');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testNonceMismatch() {
  const issuer = 'https://accounts.google.com';
  const clientId = 'google-client-id';
  const kid = 'google-test-key-2';
  const { privateKey, publicJwk } = createSigningKey(kid);
  const idToken = createIdToken({
    header: { alg: 'RS256', kid },
    payload: {
      iss: issuer,
      aud: clientId,
      sub: 'google-user-456',
      email: 'other@example.com',
      nonce: 'actual-nonce',
      exp: Math.floor(Date.now() / 1000) + 60 * 10,
    },
    privateKey,
  });

  const service = createService({
    AUTH_ENABLE_DEV_IDENTITY_BRIDGE: 'false',
    AUTH_GOOGLE_CLIENT_IDS: clientId,
  });
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    if (url === 'https://accounts.google.com/.well-known/openid-configuration') {
      return jsonResponse({
        issuer,
        jwks_uri: 'https://test.example.com/google/jwks-2',
      });
    }

    if (url === 'https://test.example.com/google/jwks-2') {
      return jsonResponse({
        keys: [publicJwk],
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    await assert.rejects(
      () =>
        service.verify({
          provider: 'GOOGLE',
          provider_payload: {
            id_token: idToken,
            nonce: 'expected-nonce',
          },
          device: {
            device_id: randomUUID(),
            platform: 'IOS',
            app_version: '0.1.0',
          },
        }),
      (error) =>
        error instanceof Error &&
        error.message === 'Invalid GOOGLE token nonce.',
    );
  } finally {
    global.fetch = originalFetch;
  }
}

async function testDevBridgeFallback() {
  const service = createService({
    AUTH_ENABLE_DEV_IDENTITY_BRIDGE: 'true',
  });

  const result = await service.verify({
    provider: 'GOOGLE',
    provider_payload: {
      provider_user_id: 'demo-google-user',
    },
    device: {
      device_id: randomUUID(),
      platform: 'IOS',
      app_version: '0.1.0',
    },
  });

  assert.equal(result.provider, 'GOOGLE');
  assert.equal(result.providerUserId, 'demo-google-user');
  assert.equal(result.providerEmail, undefined);
  assert.equal(result.rawProfileJson.mode, 'dev-identity-bridge');
}

function createService(values) {
  return new ProviderVerificationService({
    get(key) {
      return values[key];
    },
  });
}

function createSigningKey(kid) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const privateKeyObject = createPrivateKey(privateKey.export({ format: 'pem', type: 'pkcs8' }));
  const publicJwk = publicKey.export({ format: 'jwk' });

  return {
    privateKey: privateKeyObject,
    publicJwk: {
      ...publicJwk,
      use: 'sig',
      alg: 'RS256',
      kid,
    },
  };
}

function createIdToken({ header, payload, privateKey }) {
  const encodedHeader = encodeSegment(header);
  const encodedPayload = encodeSegment(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey);

  return `${signingInput}.${signature.toString('base64url')}`;
}

function encodeSegment(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function jsonResponse(body) {
  return {
    ok: true,
    async json() {
      return body;
    },
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
