const {
  CalendarConnectionStatus,
  OnboardingStatus,
} = require('@prisma/client');

const { PrismaService } = require('../dist/infra/prisma/prisma.service');
const { QueueService } = require('../dist/infra/queue/queue.service');
const { RedisService } = require('../dist/infra/redis/redis.service');
const { CalendarService } = require('../dist/modules/calendar/calendar.service');

const USER_ID = '11111111-1111-4111-8111-111111111151';

async function main() {
  const configValues = {
    ...process.env,
    CALENDAR_ENABLE_DEV_OAUTH_BRIDGE:
      process.env.CALENDAR_ENABLE_DEV_OAUTH_BRIDGE || 'true',
    CALENDAR_GOOGLE_CLIENT_ID:
      process.env.CALENDAR_GOOGLE_CLIENT_ID || 'google-calendar-client-id',
    CALENDAR_GOOGLE_CALLBACK_URI:
      process.env.CALENDAR_GOOGLE_CALLBACK_URI ||
      'https://api.example.com/v1/internal/calendar/google/callback',
  };
  const configService = {
    get(key) {
      return configValues[key];
    },
  };
  const prismaService = new PrismaService();
  const queueService = new QueueService(configService);
  const redisService = new RedisService(configService);
  const calendarService = new CalendarService(
    prismaService,
    queueService,
    redisService,
    configService,
  );

  try {
    await prismaService.calendarEvent.deleteMany({
      where: {
        userId: USER_ID,
      },
    });
    await prismaService.calendarConnection.deleteMany({
      where: {
        userId: USER_ID,
      },
    });
    await prismaService.user.upsert({
      where: {
        id: USER_ID,
      },
      create: {
        id: USER_ID,
        displayName: 'Calendar Callback Demo User',
        locale: 'ko-KR',
        timezone: 'Asia/Seoul',
        onboardingStatus: OnboardingStatus.CALENDAR_PENDING,
      },
      update: {
        displayName: 'Calendar Callback Demo User',
        locale: 'ko-KR',
        timezone: 'Asia/Seoul',
        onboardingStatus: OnboardingStatus.CALENDAR_PENDING,
      },
    });

    const started = await calendarService.startOAuthConnection(USER_ID, {
      provider: 'GOOGLE',
      redirect_uri: 'myapp://calendar-connect',
    });
    const completed = await calendarService.completeOAuthConnection('google', {
      state: started.flow_id,
      account_label: 'calendar-callback@example.com',
    });
    const successState = await redisService
      .getClient()
      .get(`oauth_state:GOOGLE:${started.flow_id}`);
    const connections = await calendarService.getConnections(USER_ID);
    const userAfterSuccess = await prismaService.user.findUnique({
      where: {
        id: USER_ID,
      },
      select: {
        onboardingStatus: true,
      },
    });

    if (!completed.success || !completed.connection_id) {
      throw new Error('Calendar OAuth callback did not create a connection.');
    }

    if (successState !== null) {
      throw new Error('Calendar OAuth state was not cleared after success.');
    }

    if (
      !userAfterSuccess ||
      userAfterSuccess.onboardingStatus !== OnboardingStatus.COMPLETED
    ) {
      throw new Error('Calendar OAuth callback did not complete onboarding.');
    }

    if (
      connections.length !== 1 ||
      connections[0].status !== CalendarConnectionStatus.ACTIVE
    ) {
      throw new Error('Calendar OAuth callback did not leave an active connection.');
    }

    const failedStart = await calendarService.startOAuthConnection(USER_ID, {
      provider: 'GOOGLE',
      redirect_uri: 'myapp://calendar-connect',
    });
    const failed = await calendarService.completeOAuthConnection('google', {
      state: failedStart.flow_id,
      error: 'access_denied',
      error_description: 'user rejected access',
    });
    const failedState = await redisService
      .getClient()
      .get(`oauth_state:GOOGLE:${failedStart.flow_id}`);

    if (failed.success || failed.error_code !== 'CALENDAR_OAUTH_DENIED') {
      throw new Error('Calendar OAuth callback did not surface provider denial.');
    }

    if (failedState !== null) {
      throw new Error('Calendar OAuth state was not cleared after failure.');
    }

    console.log(
      JSON.stringify(
        {
          started,
          completed,
          connections,
          failed,
        },
        null,
        2,
      ),
    );
  } finally {
    await redisService.onModuleDestroy();
    await queueService.onModuleDestroy();
    await prismaService.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
