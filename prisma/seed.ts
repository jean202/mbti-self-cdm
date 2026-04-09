import {
  AuthProvider,
  CalendarConnectionStatus,
  CalendarProvider,
  CalendarEventStatus,
  MbtiSource,
  OnboardingStatus,
  PrismaClient,
  TaskSourceType,
  TaskStatus,
  TodayFocusStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

const USER_ID = '11111111-1111-4111-8111-111111111111';
const AUTH_IDENTITY_ID = '11111111-1111-4111-8111-111111111112';
const MBTI_PROFILE_ID = '11111111-1111-4111-8111-111111111113';
const TODAY_FOCUS_ID = '11111111-1111-4111-8111-111111111114';
const TASK_ONE_ID = '11111111-1111-4111-8111-111111111115';
const TASK_TWO_ID = '11111111-1111-4111-8111-111111111116';
const TASK_THREE_ID = '11111111-1111-4111-8111-111111111117';
const CALENDAR_CONNECTION_ID = '11111111-1111-4111-8111-111111111118';
const CALENDAR_EVENT_ONE_ID = '11111111-1111-4111-8111-111111111119';
const CALENDAR_EVENT_TWO_ID = '11111111-1111-4111-8111-111111111120';

async function main(): Promise<void> {
  const localDate = getTodayInTimezone('Asia/Seoul');
  const localDateValue = parseLocalDate(localDate);
  const dueAt = new Date(`${localDate}T03:00:00.000Z`);
  const laterDueAt = new Date(`${localDate}T08:00:00.000Z`);
  const eventOneStart = new Date(`${localDate}T01:00:00.000Z`);
  const eventOneEnd = new Date(`${localDate}T02:00:00.000Z`);
  const eventTwoStart = new Date(`${localDate}T06:00:00.000Z`);
  const eventTwoEnd = new Date(`${localDate}T07:00:00.000Z`);

  await prisma.user.upsert({
    where: { id: USER_ID },
    create: {
      id: USER_ID,
      displayName: 'Codex Demo User',
      primaryEmail: 'demo@example.com',
      locale: 'ko-KR',
      timezone: 'Asia/Seoul',
      onboardingStatus: OnboardingStatus.COMPLETED,
    },
    update: {
      displayName: 'Codex Demo User',
      primaryEmail: 'demo@example.com',
      locale: 'ko-KR',
      timezone: 'Asia/Seoul',
      onboardingStatus: OnboardingStatus.COMPLETED,
    },
  });

  await prisma.authIdentity.upsert({
    where: { id: AUTH_IDENTITY_ID },
    create: {
      id: AUTH_IDENTITY_ID,
      userId: USER_ID,
      provider: AuthProvider.GOOGLE,
      providerUserId: 'demo-google-user',
      providerEmail: 'demo@example.com',
      providerDisplayName: 'Codex Demo User',
    },
    update: {
      userId: USER_ID,
      provider: AuthProvider.GOOGLE,
      providerUserId: 'demo-google-user',
      providerEmail: 'demo@example.com',
      providerDisplayName: 'Codex Demo User',
    },
  });

  await prisma.mbtiProfile.upsert({
    where: { userId: USER_ID },
    create: {
      id: MBTI_PROFILE_ID,
      userId: USER_ID,
      typeCode: 'INFJ',
      source: MbtiSource.SELF_SELECTED,
      isUserConfirmed: true,
      profileVersion: '2026-03-v1',
    },
    update: {
      typeCode: 'INFJ',
      source: MbtiSource.SELF_SELECTED,
      isUserConfirmed: true,
      profileVersion: '2026-03-v1',
    },
  });

  await prisma.calendarConnection.upsert({
    where: { id: CALENDAR_CONNECTION_ID },
    create: {
      id: CALENDAR_CONNECTION_ID,
      userId: USER_ID,
      provider: CalendarProvider.GOOGLE,
      providerAccountId: 'demo-google-calendar',
      accountLabel: 'Personal',
      status: CalendarConnectionStatus.ACTIVE,
      scopesJson: ['calendar.readonly'],
      syncCursorJson: { seed: true },
    },
    update: {
      userId: USER_ID,
      provider: CalendarProvider.GOOGLE,
      providerAccountId: 'demo-google-calendar',
      accountLabel: 'Personal',
      status: CalendarConnectionStatus.ACTIVE,
      scopesJson: ['calendar.readonly'],
      syncCursorJson: { seed: true },
    },
  });

  const existingTodayFocus = await prisma.todayFocus.findUnique({
    where: {
      userId_localDate: {
        userId: USER_ID,
        localDate: localDateValue,
      },
    },
    select: {
      id: true,
    },
  });

  const todayFocus = existingTodayFocus
    ? await prisma.todayFocus.update({
        where: {
          id: existingTodayFocus.id,
        },
        data: {
          title: '오늘의 초점 한 가지',
          note: 'personalized home payload 검증용 today focus',
          status: TodayFocusStatus.ACTIVE,
        },
      })
    : await prisma.todayFocus.upsert({
        where: {
          id: TODAY_FOCUS_ID,
        },
        create: {
          id: TODAY_FOCUS_ID,
          userId: USER_ID,
          localDate: localDateValue,
          title: '오늘의 초점 한 가지',
          note: 'personalized home payload 검증용 today focus',
          status: TodayFocusStatus.ACTIVE,
        },
        update: {
          userId: USER_ID,
          localDate: localDateValue,
          title: '오늘의 초점 한 가지',
          note: 'personalized home payload 검증용 today focus',
          status: TodayFocusStatus.ACTIVE,
        },
      });

  await prisma.task.upsert({
    where: { id: TASK_ONE_ID },
    create: {
      id: TASK_ONE_ID,
      userId: USER_ID,
      title: '발표 자료 수정',
      note: 'home top task 1',
      status: TaskStatus.PLANNED,
      sourceType: TaskSourceType.MANUAL,
      todayFocusId: todayFocus.id,
      dueAt,
      localDueDate: localDateValue,
      sortOrder: 10,
    },
    update: {
      title: '발표 자료 수정',
      note: 'home top task 1',
      status: TaskStatus.PLANNED,
      sourceType: TaskSourceType.MANUAL,
      todayFocusId: todayFocus.id,
      dueAt,
      localDueDate: localDateValue,
      sortOrder: 10,
    },
  });

  await prisma.task.upsert({
    where: { id: TASK_TWO_ID },
    create: {
      id: TASK_TWO_ID,
      userId: USER_ID,
      title: '회의 안건 정리',
      note: 'home top task 2',
      status: TaskStatus.IN_PROGRESS,
      sourceType: TaskSourceType.MANUAL,
      dueAt: laterDueAt,
      localDueDate: localDateValue,
      sortOrder: 20,
    },
    update: {
      title: '회의 안건 정리',
      note: 'home top task 2',
      status: TaskStatus.IN_PROGRESS,
      sourceType: TaskSourceType.MANUAL,
      dueAt: laterDueAt,
      localDueDate: localDateValue,
      sortOrder: 20,
    },
  });

  await prisma.task.upsert({
    where: { id: TASK_THREE_ID },
    create: {
      id: TASK_THREE_ID,
      userId: USER_ID,
      title: '내일 일정 확인',
      note: 'home top task 3',
      status: TaskStatus.INBOX,
      sourceType: TaskSourceType.MANUAL,
      sortOrder: 30,
    },
    update: {
      title: '내일 일정 확인',
      note: 'home top task 3',
      status: TaskStatus.INBOX,
      sourceType: TaskSourceType.MANUAL,
      sortOrder: 30,
    },
  });

  await prisma.calendarEvent.upsert({
    where: { id: CALENDAR_EVENT_ONE_ID },
    create: {
      id: CALENDAR_EVENT_ONE_ID,
      userId: USER_ID,
      connectionId: CALENDAR_CONNECTION_ID,
      providerEventId: 'seed-event-1',
      calendarName: 'Personal',
      title: '팀 회의',
      startsAt: eventOneStart,
      endsAt: eventOneEnd,
      eventStatus: CalendarEventStatus.CONFIRMED,
      lastSyncedAt: new Date(),
    },
    update: {
      userId: USER_ID,
      connectionId: CALENDAR_CONNECTION_ID,
      providerEventId: 'seed-event-1',
      calendarName: 'Personal',
      title: '팀 회의',
      startsAt: eventOneStart,
      endsAt: eventOneEnd,
      eventStatus: CalendarEventStatus.CONFIRMED,
      lastSyncedAt: new Date(),
    },
  });

  await prisma.calendarEvent.upsert({
    where: { id: CALENDAR_EVENT_TWO_ID },
    create: {
      id: CALENDAR_EVENT_TWO_ID,
      userId: USER_ID,
      connectionId: CALENDAR_CONNECTION_ID,
      providerEventId: 'seed-event-2',
      calendarName: 'Personal',
      title: '집중 작업 블록',
      startsAt: eventTwoStart,
      endsAt: eventTwoEnd,
      eventStatus: CalendarEventStatus.CONFIRMED,
      lastSyncedAt: new Date(),
    },
    update: {
      userId: USER_ID,
      connectionId: CALENDAR_CONNECTION_ID,
      providerEventId: 'seed-event-2',
      calendarName: 'Personal',
      title: '집중 작업 블록',
      startsAt: eventTwoStart,
      endsAt: eventTwoEnd,
      eventStatus: CalendarEventStatus.CONFIRMED,
      lastSyncedAt: new Date(),
    },
  });

  await prisma.todayFocus.update({
    where: { id: todayFocus.id },
    data: {
      linkedTaskId: TASK_ONE_ID,
    },
  });

  await prisma.task.update({
    where: { id: TASK_TWO_ID },
    data: {
      linkedCalendarEventId: CALENDAR_EVENT_ONE_ID,
    },
  });

  console.log(
    JSON.stringify(
      {
        seeded_user_id: USER_ID,
        local_date: localDate,
        profile_version: '2026-03-v1',
      },
      null,
      2,
    ),
  );
}

function getTodayInTimezone(timezone: string): string {
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
    throw new Error('Failed to derive local date for seed.');
  }

  return `${year}-${month}-${day}`;
}

function parseLocalDate(localDate: string): Date {
  return new Date(`${localDate}T00:00:00.000Z`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
