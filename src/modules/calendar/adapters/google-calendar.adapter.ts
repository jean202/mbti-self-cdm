import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, type Auth, type calendar_v3 } from 'googleapis';
import { createHash } from 'node:crypto';

import {
  type CalendarProviderAdapter,
  type ProviderEvent,
  type SyncResult,
} from '../calendar-sync.worker';
import { SecretsService } from '../../../common/secrets/secrets.service';

interface GoogleCalendarSource {
  id: string;
  summary?: string;
}

@Injectable()
export class GoogleCalendarAdapter implements CalendarProviderAdapter {
  private readonly logger = new Logger(GoogleCalendarAdapter.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly secretsService: SecretsService,
  ) {}

  async fetchEvents(
    credentialsRef: string,
    _syncCursor: unknown,
  ): Promise<SyncResult> {
    const oauth2Client = this.createOAuth2Client();
    const credentials = this.parseCredentials(credentialsRef);
    oauth2Client.setCredentials(credentials);

    let updatedTokens: Auth.Credentials | null = null;
    oauth2Client.on('tokens', (tokens) => {
      // refresh_token은 보통 첫 인증 시에만 받으므로, 기존 값을 유지합니다.
      updatedTokens = {
        ...credentials,
        ...tokens,
        refresh_token: tokens.refresh_token ?? credentials.refresh_token,
      };
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    try {
      const timeMin = new Date();
      timeMin.setDate(timeMin.getDate() - 30);
      const timeMax = new Date();
      timeMax.setDate(timeMax.getDate() + 365);
      const calendars = await this.listCalendars(calendar);
      const events: ProviderEvent[] = [];

      for (const source of calendars) {
        events.push(
          ...(await this.fetchCalendarEvents(
            calendar,
            source,
            timeMin,
            timeMax,
          )),
        );
      }

      let updated_credentials_ref: string | undefined;
      if (updatedTokens) {
        this.logger.log('Google API tokens were refreshed.');
        updated_credentials_ref = JSON.stringify(updatedTokens);
      }

      return {
        events,
        next_sync_cursor: null,
        updated_credentials_ref,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to fetch Google Calendar events: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private createOAuth2Client(): Auth.OAuth2Client {
    const clientId = this.readFirstConfiguredValue([
      'CALENDAR_GOOGLE_CLIENT_ID',
      'GOOGLE_OAUTH_CLIENT_ID',
    ]);
    const clientSecret = this.readFirstConfiguredValue([
      'CALENDAR_GOOGLE_CLIENT_SECRET',
      'GOOGLE_OAUTH_CLIENT_SECRET',
    ]);
    return new google.auth.OAuth2(clientId, clientSecret);
  }

  private parseCredentials(credentialsRef: string): Auth.Credentials {
    try {
      const decrypted = this.secretsService.decrypt(credentialsRef);
      return JSON.parse(decrypted);
    } catch (e) {
      this.logger.error('Failed to parse credentialsRef', e);
      throw new Error('INVALID_CREDENTIALS_FORMAT');
    }
  }

  private async listCalendars(
    calendar: calendar_v3.Calendar,
  ): Promise<GoogleCalendarSource[]> {
    try {
      const response = await calendar.calendarList.list({
        minAccessRole: 'reader',
        showDeleted: false,
        showHidden: false,
      });
      const sources =
        response.data.items
          ?.filter((item) => item.id && !item.deleted)
          .map((item) => ({
            id: item.id!,
            summary: item.summary ?? undefined,
          })) ?? [];

      return sources.length > 0 ? sources : [{ id: 'primary' }];
    } catch (error: any) {
      this.logger.warn(
        `Failed to list Google calendars. Falling back to primary calendar: ${error.message}`,
      );

      return [{ id: 'primary' }];
    }
  }

  private async fetchCalendarEvents(
    calendar: calendar_v3.Calendar,
    source: GoogleCalendarSource,
    timeMin: Date,
    timeMax: Date,
  ): Promise<ProviderEvent[]> {
    const events: ProviderEvent[] = [];
    let pageToken: string | undefined;

    do {
      const response = await calendar.events.list({
        calendarId: source.id,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        showDeleted: false,
        pageToken,
      });

      for (const item of response.data.items ?? []) {
        try {
          events.push(this.mapGoogleEvent(item, source));
        } catch (error: any) {
          this.logger.warn(
            `Skipping Google Calendar event from ${source.id}: ${error.message}`,
          );
        }
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return events;
  }

  private mapGoogleEvent(
    item: calendar_v3.Schema$Event,
    source: GoogleCalendarSource,
  ): ProviderEvent {
    const starts_at = item.start?.dateTime ?? item.start?.date;
    const ends_at = item.end?.dateTime ?? item.end?.date;

    if (!item.id || !starts_at || !ends_at) {
      throw new Error(`Event ${item.id} is missing start or end time.`);
    }

    return {
      provider_event_id: this.buildProviderEventId(source.id, item.id),
      calendar_name:
        source.summary ?? item.organizer?.displayName ?? undefined,
      title: item.summary ?? 'No Title',
      description: item.description ?? undefined,
      location: item.location ?? undefined,
      starts_at,
      ends_at,
      is_all_day: !!item.start?.date,
      event_status:
        (item.status?.toUpperCase() as 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED') ??
        'CONFIRMED',
      provider_updated_at: item.updated!,
      raw_payload: {
        ...item,
        calendar_id: source.id,
        calendar_summary: source.summary,
      },
    };
  }

  private buildProviderEventId(calendarId: string, eventId: string): string {
    return createHash('sha256')
      .update(`${calendarId}:${eventId}`)
      .digest('hex');
  }

  private readFirstConfiguredValue(keys: string[]): string | undefined {
    for (const key of keys) {
      const value = this.configService.get<string>(key)?.trim();

      if (value) {
        return value;
      }
    }

    return undefined;
  }
}
