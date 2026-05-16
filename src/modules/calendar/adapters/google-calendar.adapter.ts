import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, type Auth, type calendar_v3 } from 'googleapis';

import {
  type CalendarProviderAdapter,
  type ProviderEvent,
  type SyncResult,
} from '../calendar-sync.worker';
import { SecretsService } from '../../../common/secrets/secrets.service';

// From Google OAuth2 flow
interface GoogleCredentials {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: 'Bearer';
  expiry_date: number;
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
    syncCursor: unknown,
  ): Promise<SyncResult> {
    const oauth2Client = this.createOAuth2Client();
    const credentials = this.parseCredentials(credentialsRef);
    oauth2Client.setCredentials(credentials);

    let updatedTokens: Auth.Credentials | null = null;
    oauth2Client.on('tokens', (tokens) => {
      // refresh_token은 보통 첫 인증 시에만 받으므로, 기존 값을 유지합니다.
      if (tokens.refresh_token) {
        updatedTokens = tokens;
      } else {
        updatedTokens = { ...tokens, refresh_token: credentials.refresh_token };
      }
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    try {
      const params: calendar_v3.Params$Resource$Events$List = {
        calendarId: 'primary',
        singleEvents: true,
        maxResults: 250,
      };

      if (typeof syncCursor === 'string' && syncCursor) {
        params.syncToken = syncCursor;
      } else {
        const timeMin = new Date();
        timeMin.setDate(timeMin.getDate() - 30); // 최초 동기화 시 최근 30일 데이터
        params.timeMin = timeMin.toISOString();
      }

      const response = await calendar.events.list(params);

      const events = response.data.items?.map(this.mapGoogleEvent) ?? [];
      const nextSyncToken = response.data.nextSyncToken;

      let updated_credentials_ref: string | undefined;
      if (updatedTokens) {
        this.logger.log('Google API tokens were refreshed.');
        updated_credentials_ref = JSON.stringify(updatedTokens);
      }

      return {
        events,
        next_sync_cursor: nextSyncToken,
        updated_credentials_ref,
      };
    } catch (error: any) {
      if (error.code === 410) {
        this.logger.warn(
          'Google Calendar sync token is invalid. Performing a full sync.',
        );
        return this.fetchEvents(credentialsRef, null); // Full sync 재시도
      }
      this.logger.error(
        `Failed to fetch Google Calendar events: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private createOAuth2Client(): Auth.OAuth2Client {
    const clientId = this.configService.get<string>('GOOGLE_OAUTH_CLIENT_ID');
    const clientSecret = this.configService.get<string>(
      'GOOGLE_OAUTH_CLIENT_SECRET',
    );
    return new google.auth.OAuth2(clientId, clientSecret);
  }

  private parseCredentials(credentialsRef: string): GoogleCredentials {
    try {
      const decrypted = this.secretsService.decrypt(credentialsRef);
      return JSON.parse(decrypted);
    } catch (e) {
      this.logger.error('Failed to parse credentialsRef', e);
      throw new Error('INVALID_CREDENTIALS_FORMAT');
    }
  }

  private mapGoogleEvent(item: calendar_v3.Schema$Event): ProviderEvent {
    const starts_at = item.start?.dateTime ?? item.start?.date;
    const ends_at = item.end?.dateTime ?? item.end?.date;

    if (!starts_at || !ends_at) {
      throw new Error(`Event ${item.id} is missing start or end time.`);
    }

    return {
      provider_event_id: item.id!,
      calendar_name: item.organizer?.displayName ?? undefined,
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
      raw_payload: item,
    };
  }
}