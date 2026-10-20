import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

import type { SecretsService } from '../../../common/secrets/secrets.service';
import { GoogleCalendarAdapter } from './google-calendar.adapter';

type TokensListener = (tokens: Record<string, unknown>) => void;

const oauthClient = {
  setCredentials: jest.fn(),
  on: jest.fn(),
};
const calendarList = { list: jest.fn() };
const eventsApi = { list: jest.fn() };
const OAuth2 = jest.fn((..._args: unknown[]) => oauthClient);

jest.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: jest.fn((...args: unknown[]) => OAuth2(...args)) },
    calendar: jest.fn(() => ({ calendarList, events: eventsApi })),
  },
}));

const CREDENTIALS = { access_token: 'old-access', refresh_token: 'keep-me' };

function providerEventId(calendarId: string, eventId: string) {
  return createHash('sha256').update(`${calendarId}:${eventId}`).digest('hex');
}

function createAdapter(env: Record<string, string> = {}) {
  const secrets = {
    decrypt: jest.fn((value: string) => value.replace(/^enc\(|\)$/g, '')),
  };
  const adapter = new GoogleCalendarAdapter(
    { get: jest.fn((key: string) => env[key]) } as unknown as ConfigService,
    secrets as unknown as SecretsService,
  );

  return { adapter, secrets };
}

describe('GoogleCalendarAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    calendarList.list.mockResolvedValue({
      data: { items: [{ id: 'primary', summary: 'Me' }] },
    });
    eventsApi.list.mockResolvedValue({ data: { items: [] } });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('decrypts stored credentials and builds the client from calendar config first', async () => {
    const { adapter, secrets } = createAdapter({
      CALENDAR_GOOGLE_CLIENT_ID: 'calendar-client',
      GOOGLE_OAUTH_CLIENT_ID: 'login-client',
      GOOGLE_OAUTH_CLIENT_SECRET: 'login-secret',
    });

    await adapter.fetchEvents(`enc(${JSON.stringify(CREDENTIALS)})`, null);

    expect(secrets.decrypt).toHaveBeenCalledWith(`enc(${JSON.stringify(CREDENTIALS)})`);
    expect(OAuth2).toHaveBeenCalledWith('calendar-client', 'login-secret');
    expect(oauthClient.setCredentials).toHaveBeenCalledWith(CREDENTIALS);
  });

  it('maps timed and all-day events with stable hashed ids', async () => {
    eventsApi.list.mockResolvedValue({
      data: {
        items: [
          {
            id: 'evt-1',
            summary: '1:1',
            description: 'weekly',
            location: 'Room 4',
            status: 'confirmed',
            updated: '2026-10-19T00:00:00Z',
            start: { dateTime: '2026-10-21T10:00:00+09:00' },
            end: { dateTime: '2026-10-21T10:30:00+09:00' },
          },
          {
            id: 'evt-2',
            status: 'tentative',
            start: { date: '2026-10-22' },
            end: { date: '2026-10-23' },
          },
        ],
      },
    });
    const { adapter } = createAdapter();

    const result = await adapter.fetchEvents(JSON.stringify(CREDENTIALS), null);

    expect(result.events).toEqual([
      expect.objectContaining({
        provider_event_id: providerEventId('primary', 'evt-1'),
        calendar_name: 'Me',
        title: '1:1',
        description: 'weekly',
        location: 'Room 4',
        starts_at: '2026-10-21T10:00:00+09:00',
        ends_at: '2026-10-21T10:30:00+09:00',
        is_all_day: false,
        event_status: 'CONFIRMED',
        provider_updated_at: '2026-10-19T00:00:00Z',
      }),
      expect.objectContaining({
        provider_event_id: providerEventId('primary', 'evt-2'),
        title: 'No Title',
        starts_at: '2026-10-22',
        is_all_day: true,
        event_status: 'TENTATIVE',
      }),
    ]);
    expect(result.events[0].raw_payload).toMatchObject({
      calendar_id: 'primary',
      calendar_summary: 'Me',
    });
    expect(result.updated_credentials_ref).toBeUndefined();
  });

  it('reads every page and every visible calendar', async () => {
    calendarList.list.mockResolvedValue({
      data: {
        items: [
          { id: 'primary', summary: 'Me' },
          { id: 'team@group', summary: 'Team' },
          { id: 'gone@group', deleted: true },
        ],
      },
    });
    eventsApi.list.mockImplementation(async ({ calendarId, pageToken }) => {
      if (calendarId === 'primary' && !pageToken) {
        return {
          data: {
            items: [{ id: 'a', start: { date: '2026-10-01' }, end: { date: '2026-10-02' } }],
            nextPageToken: 'page-2',
          },
        };
      }
      if (calendarId === 'primary') {
        return {
          data: { items: [{ id: 'b', start: { date: '2026-10-03' }, end: { date: '2026-10-04' } }] },
        };
      }
      return {
        data: { items: [{ id: 'a', start: { date: '2026-10-05' }, end: { date: '2026-10-06' } }] },
      };
    });
    const { adapter } = createAdapter();

    const { events } = await adapter.fetchEvents(JSON.stringify(CREDENTIALS), null);

    expect(eventsApi.list).toHaveBeenCalledTimes(3);
    expect(eventsApi.list.mock.calls.map(([args]) => args.calendarId)).not.toContain(
      'gone@group',
    );
    // 같은 이벤트 id라도 캘린더가 다르면 다른 provider_event_id가 된다.
    expect(events.map((event) => event.provider_event_id)).toEqual([
      providerEventId('primary', 'a'),
      providerEventId('primary', 'b'),
      providerEventId('team@group', 'a'),
    ]);
    expect(events[2].calendar_name).toBe('Team');
  });

  it('falls back to the primary calendar when the calendar list fails', async () => {
    calendarList.list.mockRejectedValue(new Error('insufficient scope'));
    const { adapter } = createAdapter();

    await adapter.fetchEvents(JSON.stringify(CREDENTIALS), null);

    expect(eventsApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: 'primary', singleEvents: true }),
    );
  });

  it('skips events without start or end instead of failing the sync', async () => {
    eventsApi.list.mockResolvedValue({
      data: {
        items: [
          { id: 'broken', start: {}, end: {} },
          { id: 'ok', start: { date: '2026-10-01' }, end: { date: '2026-10-02' } },
        ],
      },
    });
    const { adapter } = createAdapter();

    const { events } = await adapter.fetchEvents(JSON.stringify(CREDENTIALS), null);

    expect(events).toHaveLength(1);
  });

  it('returns refreshed tokens while keeping the original refresh token', async () => {
    let onTokens: TokensListener | undefined;
    oauthClient.on.mockImplementation((event: string, listener: TokensListener) => {
      if (event === 'tokens') {
        onTokens = listener;
      }
    });
    eventsApi.list.mockImplementation(async () => {
      onTokens?.({ access_token: 'new-access', expiry_date: 123 });
      return { data: { items: [] } };
    });
    const { adapter } = createAdapter();

    const result = await adapter.fetchEvents(JSON.stringify(CREDENTIALS), null);

    expect(JSON.parse(result.updated_credentials_ref!)).toEqual({
      access_token: 'new-access',
      refresh_token: 'keep-me',
      expiry_date: 123,
    });
  });

  it('rejects credentials that cannot be decrypted or parsed', async () => {
    const { adapter, secrets } = createAdapter();
    secrets.decrypt.mockReturnValue('not json');

    await expect(adapter.fetchEvents('garbage', null)).rejects.toThrow(
      'INVALID_CREDENTIALS_FORMAT',
    );
    expect(eventsApi.list).not.toHaveBeenCalled();
  });

  it('propagates event API failures to the worker', async () => {
    eventsApi.list.mockRejectedValue(new Error('invalid_grant'));
    const { adapter } = createAdapter();

    await expect(
      adapter.fetchEvents(JSON.stringify(CREDENTIALS), null),
    ).rejects.toThrow('invalid_grant');
  });
});
