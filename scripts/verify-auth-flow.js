const { AppService } = require('../dist/modules/app/app.service');
const { AuthService } = require('../dist/modules/auth/auth.service');
const {
  AuthTokenService,
} = require('../dist/modules/auth/auth-token.service');
const {
  ProviderVerificationService,
} = require('../dist/modules/auth/provider-verification.service');
const { HomeService } = require('../dist/modules/home/home.service');
const { PrismaService } = require('../dist/infra/prisma/prisma.service');
const { RedisService } = require('../dist/infra/redis/redis.service');
const { SessionService } = require('../dist/modules/session/session.service');
const {
  TypeProfileLoaderService,
} = require('../dist/modules/type-profiles/type-profile-loader.service');

async function main() {
  const configService = {
    get(key) {
      return process.env[key];
    },
  };
  const prismaService = new PrismaService();
  const redisService = new RedisService(configService);
  const authTokenService = new AuthTokenService(configService);
  const sessionService = new SessionService(redisService, authTokenService);
  const providerVerificationService = new ProviderVerificationService(
    configService,
  );
  const authService = new AuthService(
    prismaService,
    sessionService,
    providerVerificationService,
  );
  const appService = new AppService(prismaService);
  const typeProfileLoaderService = new TypeProfileLoaderService(configService);
  const homeService = new HomeService(prismaService, typeProfileLoaderService);

  try {
    const login = await authService.socialLogin({
      provider: 'GOOGLE',
      provider_payload: {
        provider_user_id: 'demo-google-user',
      },
      device: {
        device_id: 'ios-simulator-001',
        platform: 'IOS',
        app_version: '0.1.0',
      },
    });

    const accessClaims = authTokenService.verifyAccessToken(
      login.tokens.access_token,
    );
    const session = await sessionService.validateAccessSession(
      accessClaims.sid,
      accessClaims.sub,
    );
    const localDate = getTodayInTimezone('Asia/Seoul');
    const bootstrap = await appService.getBootstrap(accessClaims.sub);
    const home = await homeService.getHome(accessClaims.sub, localDate);
    const refreshed = await authService.refresh({
      refresh_token: login.tokens.refresh_token,
      session_id: login.tokens.session_id,
      device_id: 'ios-simulator-001',
    });

    await authService.logout(
      {
        userId: accessClaims.sub,
        sessionId: accessClaims.sid,
        deviceId: accessClaims.did,
        accessTokenId: accessClaims.jti,
      },
      {
        refresh_token: refreshed.tokens.refresh_token,
        logout_all_devices: false,
      },
    );

    let revokedSessionCheck = 'unexpected-pass';

    try {
      await sessionService.validateAccessSession(
        accessClaims.sid,
        accessClaims.sub,
      );
    } catch (error) {
      revokedSessionCheck =
        error instanceof Error ? error.message : 'session-revoked';
    }

    console.log(
      JSON.stringify(
        {
          login,
          access_claims: accessClaims,
          session: {
            session_id: session.sessionId,
            user_id: session.userId,
            device_id: session.deviceId ?? null,
          },
          bootstrap,
          home,
          refreshed,
          revoked_session_check: revokedSessionCheck,
        },
        null,
        2,
      ),
    );
  } finally {
    await prismaService.$disconnect();
    await redisService.onModuleDestroy();
  }
}

function getTodayInTimezone(timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('Failed to derive local date for auth flow verification.');
  }

  return `${year}-${month}-${day}`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
