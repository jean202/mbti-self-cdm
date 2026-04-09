const { CalendarService } = require('../dist/modules/calendar/calendar.service');
const { PrismaService } = require('../dist/infra/prisma/prisma.service');
const { QueueService } = require('../dist/infra/queue/queue.service');
const { RedisService } = require('../dist/infra/redis/redis.service');

const USER_ID = '11111111-1111-4111-8111-111111111141';

async function main() {
  const configValues = {
    ...process.env,
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
    await prismaService.user.upsert({
      where: {
        id: USER_ID,
      },
      create: {
        id: USER_ID,
        displayName: 'Calendar OAuth Demo User',
        locale: 'ko-KR',
        timezone: 'Asia/Seoul',
      },
      update: {
        displayName: 'Calendar OAuth Demo User',
      },
    });

    const started = await calendarService.startOAuthConnection(USER_ID, {
      provider: 'GOOGLE',
      redirect_uri: 'myapp://calendar-connect',
    });
    const state = await redisService
      .getClient()
      .get(`oauth_state:GOOGLE:${started.flow_id}`);

    console.log(
      JSON.stringify(
        {
          started,
          stored_state: state ? JSON.parse(state) : null,
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
