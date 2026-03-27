import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

type AccessTokenPayload = {
  sub: string;
  sid: string;
  did?: string;
  jti: string;
  type: 'access';
  iss: string;
  iat: number;
  exp: number;
};

export interface AccessTokenClaims extends AccessTokenPayload {}

@Injectable()
export class AuthTokenService {
  constructor(private readonly configService: ConfigService) {}

  issueAccessToken(input: {
    userId: string;
    sessionId: string;
    deviceId?: string;
  }): {
    token: string;
    expiresIn: number;
    claims: AccessTokenClaims;
  } {
    const now = this.nowInSeconds();
    const expiresIn = this.getAccessTokenTtlSeconds();
    const payload: AccessTokenPayload = {
      sub: input.userId,
      sid: input.sessionId,
      did: input.deviceId,
      jti: randomUUID(),
      type: 'access',
      iss: this.getIssuer(),
      iat: now,
      exp: now + expiresIn,
    };

    const token = this.signJwt(payload, this.getAccessTokenSecret());

    return {
      token,
      expiresIn,
      claims: payload,
    };
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    const payload = this.verifyJwt(token, this.getAccessTokenSecret());

    if (
      payload.type !== 'access' ||
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      typeof payload.jti !== 'string'
    ) {
      throw new UnauthorizedException('Invalid access token.');
    }

    return payload as AccessTokenClaims;
  }

  issueRefreshToken(): {
    token: string;
    hash: string;
    expiresIn: number;
  } {
    const token = randomBytes(48).toString('base64url');

    return {
      token,
      hash: this.hashRefreshToken(token),
      expiresIn: this.getRefreshTokenTtlSeconds(),
    };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('base64url');
  }

  getAccessTokenTtlSeconds(): number {
    return this.readPositiveNumber(
      'AUTH_ACCESS_TOKEN_TTL_SECONDS',
      60 * 60,
      'AUTH_ACCESS_TOKEN_TTL_SECONDS',
    );
  }

  getRefreshTokenTtlSeconds(): number {
    return this.readPositiveNumber(
      'AUTH_REFRESH_TOKEN_TTL_SECONDS',
      60 * 60 * 24 * 30,
      'AUTH_REFRESH_TOKEN_TTL_SECONDS',
    );
  }

  private signJwt(
    payload: AccessTokenPayload,
    secret: string,
  ): string {
    const header = {
      alg: 'HS256',
      typ: 'JWT',
    };
    const encodedHeader = this.encodeSegment(header);
    const encodedPayload = this.encodeSegment(payload);
    const signature = this.signSignature(
      `${encodedHeader}.${encodedPayload}`,
      secret,
    );

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  private verifyJwt(token: string, secret: string): Record<string, unknown> {
    const parts = token.split('.');

    if (parts.length !== 3) {
      throw new UnauthorizedException('Invalid access token.');
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const expectedSignature = this.signSignature(
      `${encodedHeader}.${encodedPayload}`,
      secret,
    );

    if (!this.safeEqual(encodedSignature, expectedSignature)) {
      throw new UnauthorizedException('Invalid access token.');
    }

    const payload = this.decodePayload(encodedPayload);

    if (payload.iss !== this.getIssuer()) {
      throw new UnauthorizedException('Invalid access token issuer.');
    }

    if (typeof payload.exp !== 'number' || payload.exp <= this.nowInSeconds()) {
      throw new UnauthorizedException('Access token expired.');
    }

    return payload;
  }

  private decodePayload(encodedPayload: string): Record<string, unknown> {
    try {
      const payloadText = Buffer.from(encodedPayload, 'base64url').toString(
        'utf8',
      );
      const payload = JSON.parse(payloadText);

      if (typeof payload !== 'object' || payload === null) {
        throw new Error('invalid-payload');
      }

      return payload as Record<string, unknown>;
    } catch {
      throw new UnauthorizedException('Invalid access token.');
    }
  }

  private encodeSegment(value: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  private signSignature(input: string, secret: string): string {
    return createHmac('sha256', secret).update(input).digest('base64url');
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private nowInSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }

  private getAccessTokenSecret(): string {
    return this.readString(
      'AUTH_ACCESS_TOKEN_SECRET',
      'dev-access-secret-change-me',
      'AUTH_ACCESS_TOKEN_SECRET',
    );
  }

  private getIssuer(): string {
    return this.readString(
      'AUTH_TOKEN_ISSUER',
      'mbti-self-cdm-backend',
      'AUTH_TOKEN_ISSUER',
    );
  }

  private readPositiveNumber(
    key: string,
    fallback: number,
    label: string,
  ): number {
    const rawValue = this.configService.get<string>(key);

    if (!rawValue) {
      return fallback;
    }

    const value = Number(rawValue);

    if (!Number.isFinite(value) || value <= 0) {
      throw new InternalServerErrorException(`${label} must be positive.`);
    }

    return value;
  }

  private readString(key: string, fallback: string, label: string): string {
    const value = this.configService.get<string>(key) ?? fallback;

    if (value.trim().length === 0) {
      throw new InternalServerErrorException(`${label} must not be empty.`);
    }

    return value;
  }
}
