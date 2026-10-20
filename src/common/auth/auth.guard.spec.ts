import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';

import type { AuthTokenService } from '../../modules/auth/auth-token.service';
import type { SessionService } from '../../modules/session/session.service';
import type { RequestUser } from '../types/request-user.type';
import { AuthGuard } from './auth.guard';

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  const claims = { sub: 'user-1', sid: 'session-1', jti: 'jti-1', did: undefined };
  let authTokenService: { verifyAccessToken: jest.Mock };
  let sessionService: { validateAccessSession: jest.Mock };
  let guard: AuthGuard;

  beforeEach(() => {
    authTokenService = { verifyAccessToken: jest.fn().mockReturnValue(claims) };
    sessionService = {
      validateAccessSession: jest
        .fn()
        .mockResolvedValue({ sessionId: 'session-1', userId: 'user-1', deviceId: 'device-from-session' }),
    };
    guard = new AuthGuard(
      authTokenService as unknown as AuthTokenService,
      sessionService as unknown as SessionService,
    );
  });

  it('attaches the current user from the token and session', async () => {
    const request: { headers: Record<string, unknown>; user?: RequestUser } = {
      headers: { authorization: 'Bearer token-123' },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(authTokenService.verifyAccessToken).toHaveBeenCalledWith('token-123');
    expect(sessionService.validateAccessSession).toHaveBeenCalledWith(
      'session-1',
      'user-1',
    );
    expect(request.user).toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      deviceId: 'device-from-session',
      accessTokenId: 'jti-1',
    });
  });

  it('prefers the device id embedded in the token', async () => {
    authTokenService.verifyAccessToken.mockReturnValue({ ...claims, did: 'device-from-token' });
    const request: { headers: Record<string, unknown>; user?: RequestUser } = {
      headers: { authorization: 'Bearer token-123' },
    };

    await guard.canActivate(contextFor(request));

    expect(request.user?.deviceId).toBe('device-from-token');
  });

  it('reads the first value when the header arrives as an array', async () => {
    const request = { headers: { authorization: ['Bearer first', 'Bearer second'] } };

    await guard.canActivate(contextFor(request));

    expect(authTokenService.verifyAccessToken).toHaveBeenCalledWith('first');
  });

  it.each([
    ['no header', {}],
    ['a non-bearer scheme', { authorization: 'Basic dXNlcjpwYXNz' }],
    ['an empty bearer token', { authorization: 'Bearer    ' }],
    ['a lowercase scheme', { authorization: 'bearer token-123' }],
  ])('rejects %s', async (_label, headers) => {
    await expect(guard.canActivate(contextFor({ headers }))).rejects.toThrow(
      new UnauthorizedException('Missing Bearer token.'),
    );
    expect(authTokenService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('propagates token verification failures', async () => {
    authTokenService.verifyAccessToken.mockImplementation(() => {
      throw new UnauthorizedException('Access token expired.');
    });

    await expect(
      guard.canActivate(contextFor({ headers: { authorization: 'Bearer old' } })),
    ).rejects.toThrow('Access token expired.');
    expect(sessionService.validateAccessSession).not.toHaveBeenCalled();
  });

  it('rejects a valid token whose session was revoked', async () => {
    sessionService.validateAccessSession.mockRejectedValue(
      new UnauthorizedException('Session is invalid.'),
    );

    await expect(
      guard.canActivate(contextFor({ headers: { authorization: 'Bearer t' } })),
    ).rejects.toThrow('Session is invalid.');
  });
});
