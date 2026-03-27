import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { RedisService } from '../../infra/redis/redis.service';
import { AuthTokenService } from '../auth/auth-token.service';

type SessionRecord = {
  sessionId: string;
  userId: string;
  deviceId?: string;
  platform: string;
  appVersion: string;
  refreshTokenHash: string;
  createdAt: string;
  lastRefreshedAt: string;
  lastAccessedAt: string;
};

type CreateSessionInput = {
  userId: string;
  deviceId?: string;
  platform: string;
  appVersion: string;
};

type RotateRefreshTokenInput = {
  sessionId: string;
  refreshToken: string;
  deviceId?: string;
};

type SessionTokens = {
  access_token: string;
  access_token_expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
  session_id: string;
};

@Injectable()
export class SessionService {
  constructor(
    private readonly redisService: RedisService,
    private readonly authTokenService: AuthTokenService,
  ) {}

  async createSession(input: CreateSessionInput): Promise<SessionTokens> {
    const now = new Date().toISOString();
    const sessionId = randomUUID();
    const refreshToken = this.authTokenService.issueRefreshToken();
    const session: SessionRecord = {
      sessionId,
      userId: input.userId,
      deviceId: input.deviceId,
      platform: input.platform,
      appVersion: input.appVersion,
      refreshTokenHash: refreshToken.hash,
      createdAt: now,
      lastRefreshedAt: now,
      lastAccessedAt: now,
    };

    await this.storeSession(session);

    const accessToken = this.authTokenService.issueAccessToken({
      userId: session.userId,
      sessionId: session.sessionId,
      deviceId: session.deviceId,
    });

    return {
      access_token: accessToken.token,
      access_token_expires_in: accessToken.expiresIn,
      refresh_token: refreshToken.token,
      refresh_token_expires_in: refreshToken.expiresIn,
      session_id: session.sessionId,
    };
  }

  async rotateRefreshToken(
    input: RotateRefreshTokenInput,
  ): Promise<SessionTokens> {
    const session = await this.readSession(input.sessionId);

    if (!session) {
      throw new UnauthorizedException('Session was not found.');
    }

    if (
      input.deviceId &&
      session.deviceId &&
      input.deviceId !== session.deviceId
    ) {
      throw new UnauthorizedException('Device does not match session.');
    }

    if (
      this.authTokenService.hashRefreshToken(input.refreshToken) !==
      session.refreshTokenHash
    ) {
      throw new UnauthorizedException('Refresh token is invalid.');
    }

    const rotatedRefreshToken = this.authTokenService.issueRefreshToken();
    const updatedSession: SessionRecord = {
      ...session,
      refreshTokenHash: rotatedRefreshToken.hash,
      lastRefreshedAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
    };

    await this.storeSession(updatedSession);

    const accessToken = this.authTokenService.issueAccessToken({
      userId: updatedSession.userId,
      sessionId: updatedSession.sessionId,
      deviceId: updatedSession.deviceId,
    });

    return {
      access_token: accessToken.token,
      access_token_expires_in: accessToken.expiresIn,
      refresh_token: rotatedRefreshToken.token,
      refresh_token_expires_in: rotatedRefreshToken.expiresIn,
      session_id: updatedSession.sessionId,
    };
  }

  async validateAccessSession(
    sessionId: string,
    userId: string,
  ): Promise<SessionRecord> {
    const session = await this.readSession(sessionId);

    if (!session || session.userId !== userId) {
      throw new UnauthorizedException('Session is invalid.');
    }

    return session;
  }

  async revokeSession(
    sessionId: string,
    userId: string,
    refreshToken?: string,
  ): Promise<void> {
    const session = await this.readSession(sessionId);

    if (!session) {
      return;
    }

    if (session.userId !== userId) {
      throw new UnauthorizedException('Session is invalid.');
    }

    if (
      refreshToken &&
      this.authTokenService.hashRefreshToken(refreshToken) !==
        session.refreshTokenHash
    ) {
      throw new UnauthorizedException('Refresh token is invalid.');
    }

    const client = this.redisService.getClient();

    await client.del(this.getSessionKey(sessionId));
    await client.srem(this.getUserSessionsKey(userId), sessionId);
  }

  async revokeAllSessions(userId: string): Promise<void> {
    const client = this.redisService.getClient();
    const userSessionsKey = this.getUserSessionsKey(userId);
    const sessionIds = await client.smembers(userSessionsKey);

    if (sessionIds.length > 0) {
      const sessionKeys = sessionIds.map((sessionId) => this.getSessionKey(sessionId));

      await client.del(...sessionKeys);
      await client.del(userSessionsKey);
    }
  }

  private async storeSession(session: SessionRecord): Promise<void> {
    const client = this.redisService.getClient();
    const ttlSeconds = this.authTokenService.getRefreshTokenTtlSeconds();

    await client.set(
      this.getSessionKey(session.sessionId),
      JSON.stringify(session),
      'EX',
      ttlSeconds,
    );
    await client.sadd(this.getUserSessionsKey(session.userId), session.sessionId);
    await client.expire(this.getUserSessionsKey(session.userId), ttlSeconds);
  }

  private async readSession(sessionId: string): Promise<SessionRecord | null> {
    const client = this.redisService.getClient();
    const rawValue = await client.get(this.getSessionKey(sessionId));

    if (!rawValue) {
      return null;
    }

    return JSON.parse(rawValue) as SessionRecord;
  }

  private getSessionKey(sessionId: string): string {
    return `auth:session:${sessionId}`;
  }

  private getUserSessionsKey(userId: string): string {
    return `auth:user-sessions:${userId}`;
  }
}
