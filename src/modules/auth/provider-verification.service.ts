import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider } from '@prisma/client';
import { createPublicKey, verify } from 'node:crypto';

import { SocialLoginDto } from './dto/social-login.dto';

type OpenIdConfiguration = {
  issuer: string;
  jwks_uri: string;
};

type CachedValue<T> = {
  value: T;
  expiresAt: number;
};

type JwtHeader = {
  alg?: unknown;
  kid?: unknown;
};

type JwtPayload = {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  email?: unknown;
  name?: unknown;
  nickname?: unknown;
  exp?: unknown;
  nonce?: unknown;
};

type RsaJsonWebKey = {
  kty?: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
};

type VerifiedSocialIdentity = {
  provider: AuthProvider;
  providerUserId: string;
  providerEmail?: string;
  providerDisplayName?: string;
  rawProfileJson: Record<string, unknown>;
};

type ProviderOpenIdConfig = {
  discoveryUrl: string;
  allowedIssuers: string[];
  clientIdsEnvKey: string;
};

const PROVIDER_CONFIG: Record<AuthProvider, ProviderOpenIdConfig> = {
  [AuthProvider.GOOGLE]: {
    discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
    allowedIssuers: ['https://accounts.google.com', 'accounts.google.com'],
    clientIdsEnvKey: 'AUTH_GOOGLE_CLIENT_IDS',
  },
  [AuthProvider.APPLE]: {
    discoveryUrl: 'https://appleid.apple.com/.well-known/openid-configuration',
    allowedIssuers: ['https://appleid.apple.com'],
    clientIdsEnvKey: 'AUTH_APPLE_CLIENT_IDS',
  },
  [AuthProvider.KAKAO]: {
    discoveryUrl: 'https://kauth.kakao.com/.well-known/openid-configuration',
    allowedIssuers: ['https://kauth.kakao.com'],
    clientIdsEnvKey: 'AUTH_KAKAO_CLIENT_IDS',
  },
  [AuthProvider.NAVER]: {
    discoveryUrl: 'https://nid.naver.com/.well-known/openid-configuration',
    allowedIssuers: ['https://nid.naver.com'],
    clientIdsEnvKey: 'AUTH_NAVER_CLIENT_IDS',
  },
};

@Injectable()
export class ProviderVerificationService {
  private readonly discoveryCache = new Map<string, CachedValue<unknown>>();
  private readonly jwksCache = new Map<string, CachedValue<unknown>>();

  constructor(private readonly configService: ConfigService) {}

  async verify(input: SocialLoginDto): Promise<VerifiedSocialIdentity> {
    const idToken = input.provider_payload.id_token?.trim();

    if (idToken) {
      return this.verifyIdToken(input.provider, idToken, input.provider_payload.nonce);
    }

    if (input.provider_payload.authorization_code?.trim()) {
      throw new BadRequestException({
        code: 'AUTH_CODE_EXCHANGE_NOT_IMPLEMENTED',
        message:
          'authorization_code exchange is not implemented yet. Send provider_payload.id_token from the client SDK.',
      });
    }

    if (this.isDevIdentityBridgeEnabled()) {
      const providerUserId = input.provider_payload.provider_user_id?.trim();
      const providerEmail = this.normalizeEmail(
        input.provider_payload.provider_email,
      );

      if (!providerUserId && !providerEmail) {
        throw new BadRequestException({
          code: 'INVALID_PROVIDER_PAYLOAD',
          message:
            'provider_payload.id_token is required. Development bridge also accepts provider_user_id or provider_email.',
        });
      }

      return {
        provider: input.provider,
        providerUserId: providerUserId ?? providerEmail ?? 'dev-user',
        providerEmail,
        rawProfileJson: {
          mode: 'dev-identity-bridge',
          provider_payload: input.provider_payload,
        },
      };
    }

    throw new BadRequestException({
      code: 'INVALID_PROVIDER_PAYLOAD',
      message: 'provider_payload.id_token is required.',
    });
  }

  private async verifyIdToken(
    provider: AuthProvider,
    idToken: string,
    expectedNonce?: string,
  ): Promise<VerifiedSocialIdentity> {
    const parsedToken = this.parseJwt(idToken);
    const providerConfig = PROVIDER_CONFIG[provider];
    const discovery = await this.getOpenIdConfiguration(providerConfig.discoveryUrl);
    const jwk = await this.getSigningKey(discovery.jwks_uri, parsedToken.header.kid);

    this.verifyJwtSignature(parsedToken.signingInput, parsedToken.signature, jwk);
    this.validateJwtClaims(
      provider,
      parsedToken.payload,
      providerConfig.allowedIssuers,
      providerConfig.clientIdsEnvKey,
      expectedNonce,
    );

    const providerUserId = this.readStringClaim(parsedToken.payload.sub, 'sub');

    return {
      provider,
      providerUserId,
      providerEmail: this.normalizeEmail(parsedToken.payload.email),
      providerDisplayName: this.readDisplayName(parsedToken.payload),
      rawProfileJson: {
        header: parsedToken.header,
        payload: parsedToken.payload,
      },
    };
  }

  private parseJwt(token: string): {
    header: JwtHeader;
    payload: JwtPayload;
    signingInput: string;
    signature: Buffer;
  } {
    const parts = token.split('.');

    if (parts.length !== 3) {
      throw new UnauthorizedException('Invalid social id_token.');
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = this.decodeSegment<JwtHeader>(encodedHeader);
    const payload = this.decodeSegment<JwtPayload>(encodedPayload);

    if (header.alg !== 'RS256') {
      throw new UnauthorizedException('Unsupported id_token signing algorithm.');
    }

    if (typeof header.kid !== 'string' || header.kid.length === 0) {
      throw new UnauthorizedException('Missing id_token kid.');
    }

    return {
      header,
      payload,
      signingInput: `${encodedHeader}.${encodedPayload}`,
      signature: Buffer.from(encodedSignature, 'base64url'),
    };
  }

  private validateJwtClaims(
    provider: AuthProvider,
    payload: JwtPayload,
    allowedIssuers: string[],
    clientIdsEnvKey: string,
    expectedNonce?: string,
  ): void {
    const issuer = this.readStringClaim(payload.iss, 'iss');

    if (!allowedIssuers.includes(issuer)) {
      throw new UnauthorizedException(`Invalid ${provider} token issuer.`);
    }

    const allowedClientIds = this.readClientIds(clientIdsEnvKey);
    const audiences = this.readAudienceClaims(payload.aud);
    const audienceMatched = audiences.some((audience) =>
      allowedClientIds.includes(audience),
    );

    if (!audienceMatched) {
      throw new UnauthorizedException(`Invalid ${provider} token audience.`);
    }

    if (typeof payload.exp !== 'number' || payload.exp <= this.nowInSeconds()) {
      throw new UnauthorizedException(`${provider} id_token expired.`);
    }

    if (expectedNonce) {
      const nonce = this.readOptionalStringClaim(payload.nonce);

      if (!nonce || nonce !== expectedNonce) {
        throw new UnauthorizedException(`Invalid ${provider} token nonce.`);
      }
    }
  }

  private verifyJwtSignature(
    signingInput: string,
    signature: Buffer,
    jwk: RsaJsonWebKey,
  ): void {
    try {
      const publicKey = createPublicKey({
        key: jwk,
        format: 'jwk',
      });
      const verified = verify(
        'RSA-SHA256',
        Buffer.from(signingInput),
        publicKey,
        signature,
      );

      if (!verified) {
        throw new UnauthorizedException('Invalid id_token signature.');
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Invalid id_token signature.');
    }
  }

  private async getSigningKey(
    jwksUrl: string,
    kid: unknown,
  ): Promise<RsaJsonWebKey> {
    if (typeof kid !== 'string' || kid.length === 0) {
      throw new UnauthorizedException('Missing id_token kid.');
    }

    const keys = await this.getJsonWithCache<RsaJsonWebKey[]>(jwksUrl, async () => {
      const response = await fetch(jwksUrl);

      if (!response.ok) {
        throw new ServiceUnavailableException('Failed to load provider JWKS.');
      }

      const body = (await response.json()) as { keys?: RsaJsonWebKey[] };

      if (!Array.isArray(body.keys)) {
        throw new ServiceUnavailableException('Provider JWKS is invalid.');
      }

      return body.keys;
    });
    const signingKey = keys.find(
      (key) =>
        key.kid === kid &&
        key.kty === 'RSA' &&
        key.n &&
        key.e,
    );

    if (!signingKey) {
      throw new UnauthorizedException('Provider signing key was not found.');
    }

    return signingKey;
  }

  private async getOpenIdConfiguration(
    discoveryUrl: string,
  ): Promise<OpenIdConfiguration> {
    return this.getJsonWithCache<OpenIdConfiguration>(discoveryUrl, async () => {
      const response = await fetch(discoveryUrl);

      if (!response.ok) {
        throw new ServiceUnavailableException(
          'Failed to load provider OpenID configuration.',
        );
      }

      const body = (await response.json()) as Partial<OpenIdConfiguration>;

      if (
        typeof body.issuer !== 'string' ||
        typeof body.jwks_uri !== 'string'
      ) {
        throw new ServiceUnavailableException(
          'Provider OpenID configuration is invalid.',
        );
      }

      return {
        issuer: body.issuer,
        jwks_uri: body.jwks_uri,
      };
    });
  }

  private async getJsonWithCache<T>(
    url: string,
    loader: () => Promise<T>,
  ): Promise<T> {
    const targetCache = url.includes('/.well-known/')
      ? this.discoveryCache
      : this.jwksCache;
    const cached = targetCache.get(url);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }

    try {
      const value = await loader();

      targetCache.set(url, {
        value: value as unknown,
        expiresAt: Date.now() + 60 * 60 * 1000,
      });

      return value;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException ||
        error instanceof ServiceUnavailableException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }

      throw new ServiceUnavailableException('Provider verification failed.');
    }
  }

  private decodeSegment<T>(value: string): T {
    try {
      return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
    } catch {
      throw new UnauthorizedException('Invalid social id_token.');
    }
  }

  private readAudienceClaims(aud: unknown): string[] {
    if (typeof aud === 'string' && aud.length > 0) {
      return [aud];
    }

    if (Array.isArray(aud) && aud.every((item) => typeof item === 'string')) {
      return aud;
    }

    throw new UnauthorizedException('Invalid token audience.');
  }

  private readClientIds(envKey: string): string[] {
    const rawValue = this.configService.get<string>(envKey);
    const clientIds = rawValue
      ?.split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (!clientIds || clientIds.length === 0) {
      throw new InternalServerErrorException(`${envKey} is not configured.`);
    }

    return clientIds;
  }

  private readStringClaim(value: unknown, claimName: string): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new UnauthorizedException(`Invalid token ${claimName} claim.`);
    }

    return value;
  }

  private readOptionalStringClaim(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private readDisplayName(payload: JwtPayload): string | undefined {
    return (
      this.readOptionalStringClaim(payload.name) ??
      this.readOptionalStringClaim(payload.nickname)
    );
  }

  private normalizeEmail(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim().toLowerCase()
      : undefined;
  }

  private isDevIdentityBridgeEnabled(): boolean {
    return (
      (this.configService.get<string>('AUTH_ENABLE_DEV_IDENTITY_BRIDGE') ??
        'true') === 'true'
    );
  }

  private nowInSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }
}
