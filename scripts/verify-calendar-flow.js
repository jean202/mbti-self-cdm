const { CalendarConnectionStatus, CalendarEventStatus, CalendarProvider, OnboardingStatus } = require('@prisma/client');

const { PrismaService } = require('../dist/infra/prisma/prisma.service');
const { QueueService } = require('../dist/infra/queue/queue.service');
const { RedisService } = require('../dist/infra/redis/redis.service');
const { CalendarService } = require('../dist/modules/calendar/calendar.service');

const USER_ID = '11111111-1111-4111-8111-111111111131';
const CONNECTION_ID = '11111111-1111-4111-8111-111111111132';
const EVENT_ONE_ID = '11111111-1111-4111-8111-111111111133';
const EVENT_TWO_ID = '11111111-1111-4111-8111-111111111134';

async function main() {
  const configService = {
    get(key) {
      return process.env[key];
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
  const range = buildRange();

  try {
    await seedCalendarFixtures(prismaService, range);

    const beforeSync = await calendarService.getConnections(USER_ID);
    const sync = await calendarService.syncConnection(USER_ID, CONNECTION_ID);
    const events = await calendarService.listEvents(USER_ID, {
      from: range.from,
      to: range.to,
      connection_id: CONNECTION_ID,
    });
    const revoke = await calendarService.revokeConnection(USER_ID, CONNECTION_ID);
    const afterRevoke = await calendarService.getConnections(USER_ID);

    console.log(
      JSON.stringify(
        {
          before_sync: beforeSync,
          sync,
          events,
          revoke,
          after_revoke: afterRevoke,
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

async function seedCalendarFixtures(prismaService, range) {
  await prismaService.calendarEvent.deleteMany({
    where: {
      connectionId: CONNECTION_ID,
    },
  });

  await prismaService.calendarConnection.deleteMany({
    where: {
      id: CONNECTION_ID,
    },
  });

  await prismaService.user.upsert({
    where: {
      id: USER_ID,
    },
    create: {
      id: USER_ID,
      displayName: 'Calendar Flow Demo User',
      locale: 'ko-KR',
      timezone: 'Asia/Seoul',
      onboardingStatus: OnboardingStatus.COMPLETED,
    },
    update: {
      displayName: 'Calendar Flow Demo User',
      locale: 'ko-KR',
      timezone: 'Asia/Seoul',
      onboardingStatus: OnboardingStatus.COMPLETED,
    },
  });

  await prismaService.calendarConnection.create({
    data: {
      id: CONNECTION_ID,
      userId: USER_ID,
      provider: CalendarProvider.GOOGLE,
      providerAccountId: 'calendar-flow-demo-google',
      accountLabel: 'calendar-flow@example.com',
      status: CalendarConnectionStatus.ACTIVE,
      scopesJson: ['calendar.readonly'],
      syncCursorJson: { seed: true },
    },
  });

  await prismaService.calendarEvent.createMany({
    data: [
      {
        id: EVENT_ONE_ID,
        userId: USER_ID,
        connectionId: CONNECTION_ID,
        providerEventId: 'calendar-flow-event-1',
        calendarName: 'Personal',
        title: '전략 회의',
        startsAt: new Date(range.from),
        endsAt: new Date(new Date(range.from).getTime() + 60 * 60 * 1000),
        isAllDay: false,
        eventStatus: CalendarEventStatus.CONFIRMED,
        lastSyncedAt: new Date(),
      },
      {
        id: EVENT_TWO_ID,
        userId: USER_ID,
        connectionId: CONNECTION_ID,
        providerEventId: 'calendar-flow-event-2',
        calendarName: 'Personal',
        title: '집중 작업 블록',
        startsAt: new Date(new Date(range.from).getTime() + 4 * 60 * 60 * 1000),
        endsAt: new Date(new Date(range.from).getTime() + 6 * 60 * 60 * 1000),
        isAllDay: false,
        eventStatus: CalendarEventStatus.CONFIRMED,
        lastSyncedAt: new Date(),
      },
    ],
  });
}

function buildRange() {
  const now = new Date();
  const fromDate = new Date(now);
  fromDate.setUTCHours(0, 0, 0, 0);
  const toDate = new Date(fromDate);
  toDate.setUTCDate(toDate.getUTCDate() + 1);

  return {
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
