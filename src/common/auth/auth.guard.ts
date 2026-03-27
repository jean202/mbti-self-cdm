import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { RequestUser } from '../types/request-user.type';
import { AuthTokenService } from '../../modules/auth/auth-token.service';
import { SessionService } from '../../modules/session/session.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authTokenService: AuthTokenService,
    private readonly sessionService: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<
      FastifyRequest & { user?: RequestUser }
    >();
    const accessToken = this.readBearerToken(request);

    if (!accessToken) {
      throw new UnauthorizedException('Missing Bearer token.');
    }

    const claims = this.authTokenService.verifyAccessToken(accessToken);
    const session = await this.sessionService.validateAccessSession(
      claims.sid,
      claims.sub,
    );

    request.user = {
      userId: claims.sub,
      sessionId: claims.sid,
      deviceId: claims.did ?? session.deviceId,
      accessTokenId: claims.jti,
    };

    return true;
  }

  private readBearerToken(request: FastifyRequest): string | undefined {
    const authorization = request.headers.authorization;

    if (Array.isArray(authorization)) {
      return this.extractBearerToken(authorization[0]);
    }

    if (typeof authorization === 'string') {
      return this.extractBearerToken(authorization);
    }

    return undefined;
  }

  private extractBearerToken(value: string): string | undefined {
    if (!value.startsWith('Bearer ')) {
      return undefined;
    }

    const token = value.slice('Bearer '.length).trim();

    return token.length > 0 ? token : undefined;
  }
}
