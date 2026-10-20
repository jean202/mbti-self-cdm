import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CalendarConnectionStatus, Prisma } from '@prisma/client';
import type { Job } from 'bullmq';

import type { SecretsService } from '../../common/secrets/secrets.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { GoogleCalendarAdapter } from './adapters/google-calendar.adapter';
import {
  CalendarSyncWorker,
  type CalendarSyncJobData,
  type ProviderEvent,
} from './calendar-sync.worker';

const CONNECTION = {
  id: 'conn-1',
  userId: 'user-1',
  provider: 'GOOGLE',
  status: CalendarConnectionStatus.SYNCING,
  credentialsRef: 'encrypted-credentials',
  syncCursorJson: null,
};

function job(data: Partial<CalendarSyncJobData> = {}): Job<CalendarSyncJobData> {
  return {
    id: 'job-1',
    data: {
      connection_id: 'conn-1',
      user_id: 'user-1',
      provider: 'GOOGLE',
      requested_at: '2026-10-20T00:00:00.000Z',
      ...data,
    },
  } as Job<CalendarSyncJobData>;
}

function createHarness(env: Record<string, string> = {}) {
  const prisma = {
    calendarConnection: {
      findUnique: jest.fn().mockResolvedValue(CONNECTION),
      update: jest.fn(),
    },
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'Asia/Seoul' }),
    },
    calendarEvent: { upsert: jest.fn() },
  };
  const googleAdapter = {
    fetchEvents: jest.fn().mockResolvedValue({ events: [], next_sync_cursor: null }),
  };
  const secrets = { encrypt: jest.fn((value: string) => `enc(${value})`) };
  const worker = new CalendarSyncWorker(
    prisma as unknown as PrismaService,
    { get: jest.fn((key: string) => env[key]) } as unknown as ConfigService,
    googleAdapter as unknown as GoogleCalendarAdapter,
    secrets as unknown as SecretsService,
  );
  const process = (input = job()) =>
    (worker as unknown as {
      processJob: (j: Job<CalendarSyncJobData>) => Promise<void>;
    }).processJob(input);

  return { worker, prisma, googleAdapter, secrets, process };
}

describe('CalendarSyncWorker', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('upserts fetched events and marks the connection active', async () => {
    const { prisma, googleAdapter, process } = createHarness();
    const events: ProviderEvent[] = [
      {
        provider_event_id: 'evt-timed',
        calendar_name: 'Work',
        title: 'Design review',
        starts_at: '2026-10-21T01:00:00Z',
        ends_at: '2026-10-21T02:00:00Z',
        is_all_day: false,
        event_status: 'CONFIRMED',
        provider_updated_at: '2026-10-19T12:00:00Z',
        raw_payload: { id: 'g-1' },
      },
      {
        provider_event_id: 'evt-all-day',
        title: '연차',
        starts_at: '2026-10-22',
        ends_at: '2026-10-23',
        is_all_day: true,
        event_status: 'TENTATIVE',
      },
    ];
    googleAdapter.fetchEvents.mockResolvedValue({
      events,
      next_sync_cursor: { page: 'next' },
    });

    await process();

    expect(googleAdapter.fetchEvents).toHaveBeenCalledWith('encrypted-credentials', null);
    expect(prisma.calendarEvent.upsert).toHaveBeenCalledTimes(2);
    const [timed, allDay] = prisma.calendarEvent.upsert.mock.calls.map(([args]) => args);
    expect(timed.where).toEqual({
      connectionId_providerEventId: { connectionId: 'conn-1', providerEventId: 'evt-timed' },
    });
    expect(timed.create).toMatchObject({
      userId: 'user-1',
      title: 'Design review',
      calendarName: 'Work',
      startsAt: new Date('2026-10-21T01:00:00Z'),
      providerUpdatedAt: new Date('2026-10-19T12:00:00Z'),
      rawPayloadJson: { id: 'g-1' },
    });
    // 종일 일정은 사용자 타임존(Asia/Seoul, UTC+9)의 자정으로 저장한다.
    expect(allDay.create).toMatchObject({
      isAllDay: true,
      startsAt: new Date('2026-10-21T15:00:00.000Z'),
      endsAt: new Date('2026-10-22T15:00:00.000Z'),
      calendarName: null,
      providerUpdatedAt: null,
      rawPayloadJson: Prisma.JsonNull,
    });
    expect(prisma.calendarConnection.update).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
      data: expect.objectContaining({
        status: CalendarConnectionStatus.ACTIVE,
        lastSyncedAt: expect.any(Date),
        lastErrorCode: null,
        syncCursorJson: { page: 'next' },
      }),
    });
  });

  it('re-encrypts refreshed provider credentials', async () => {
    const { prisma, googleAdapter, process } = createHarness();
    googleAdapter.fetchEvents.mockResolvedValue({
      events: [],
      updated_credentials_ref: '{"access_token":"new"}',
    });

    await process();

    expect(prisma.calendarConnection.update.mock.calls[0][0].data).toMatchObject({
      credentialsRef: 'enc({"access_token":"new"})',
      syncCursorJson: Prisma.JsonNull,
    });
  });

  it('skips missing and revoked connections', async () => {
    const { prisma, googleAdapter, process } = createHarness();

    prisma.calendarConnection.findUnique.mockResolvedValueOnce(null);
    await process();
    prisma.calendarConnection.findUnique.mockResolvedValueOnce({
      ...CONNECTION,
      status: CalendarConnectionStatus.REVOKED,
    });
    await process();

    expect(googleAdapter.fetchEvents).not.toHaveBeenCalled();
    expect(prisma.calendarConnection.update).not.toHaveBeenCalled();
  });

  it('marks a connection without credentials as an error', async () => {
    const { prisma, googleAdapter, process } = createHarness();
    prisma.calendarConnection.findUnique.mockResolvedValue({
      ...CONNECTION,
      credentialsRef: null,
    });

    await process();

    expect(googleAdapter.fetchEvents).not.toHaveBeenCalled();
    expect(prisma.calendarConnection.update).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
      data: { status: CalendarConnectionStatus.ERROR, lastErrorCode: 'MISSING_CREDENTIALS' },
    });
  });

  it('records the provider error and rethrows so BullMQ can retry', async () => {
    const { prisma, googleAdapter, process } = createHarness();
    const longMessage = `invalid_grant: ${'x'.repeat(100)}`;
    googleAdapter.fetchEvents.mockRejectedValue(new Error(longMessage));

    await expect(process()).rejects.toThrow('invalid_grant');

    expect(prisma.calendarConnection.update).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
      data: {
        status: CalendarConnectionStatus.ERROR,
        lastErrorCode: longMessage.slice(0, 64),
      },
    });
  });

  it('uses the stub adapter in dev bridge mode even without credentials', async () => {
    const { prisma, googleAdapter, process } = createHarness({
      CALENDAR_ENABLE_DEV_OAUTH_BRIDGE: 'true',
    });
    prisma.calendarConnection.findUnique.mockResolvedValue({
      ...CONNECTION,
      credentialsRef: null,
    });

    await process();

    expect(googleAdapter.fetchEvents).not.toHaveBeenCalled();
    expect(prisma.calendarConnection.update.mock.calls[0][0].data.status).toBe(
      CalendarConnectionStatus.ACTIVE,
    );
  });

  it('uses the stub adapter for providers without an integration', async () => {
    const { prisma, googleAdapter, process } = createHarness();
    prisma.calendarConnection.findUnique.mockResolvedValue({
      ...CONNECTION,
      provider: 'APPLE',
    });

    await process();

    expect(googleAdapter.fetchEvents).not.toHaveBeenCalled();
    expect(prisma.calendarEvent.upsert).not.toHaveBeenCalled();
  });
});
