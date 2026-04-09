import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CalendarConnectionStatus, CalendarEventStatus } from '@prisma/client';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';

import { PrismaService } from '../../infra/prisma/prisma.service';

export interface CalendarSyncJobData {
  connection_id: string;
  user_id: string;
  provider: string;
  requested_at: string;
}

export interface ProviderEvent {
  provider_event_id: string;
  calendar_name?: string;
  title: string;
  description?: string;
  location?: string;
  starts_at: string;
  ends_at: string;
  is_all_day: boolean;
  event_status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  provider_updated_at?: string;
  raw_payload?: unknown;
}

export interface SyncResult {
  events: ProviderEvent[];
  next_sync_cursor?: unknown;
}

export interface CalendarProviderAdapter {
  fetchEvents(
    credentialsRef: string,
    syncCursor: unknown | null,
  ): Promise<SyncResult>;
}

@Injectable()
export class CalendarSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CalendarSyncWorker.name);
  private worker?: Worker;
  private connection?: Redis;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    this.connection = new Redis(this.getRedisUrl(), {
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });

    this.worker = new Worker<CalendarSyncJobData>(
      'calendar-sync',
      (job) => this.processJob(job),
      {
        connection: this.connection,
        concurrency: 3,
        limiter: { max: 10, duration: 60_000 },
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Job ${job?.id} failed: ${err.message}`,
        err.stack,
      );
    });

    this.logger.log('Calendar sync worker started');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
    if (this.connection) {
      await this.connection.quit();
    }
  }

  private async processJob(job: Job<CalendarSyncJobData>): Promise<void> {
    const { connection_id, user_id } = job.data;

    this.logger.log(
      `Processing sync for connection ${connection_id} (user: ${user_id})`,
    );

    const connection = await this.prismaService.calendarConnection.findUnique({
      where: { id: connection_id },
      select: {
        id: true,
        userId: true,
        provider: true,
        status: true,
        credentialsRef: true,
        syncCursorJson: true,
      },
    });

    if (!connection) {
      this.logger.warn(`Connection ${connection_id} not found, skipping`);
      return;
    }

    if (connection.status === CalendarConnectionStatus.REVOKED) {
      this.logger.warn(`Connection ${connection_id} is revoked, skipping`);
      return;
    }

    if (!connection.credentialsRef) {
      await this.markConnectionError(connection_id, 'MISSING_CREDENTIALS');
      return;
    }

    try {
      const adapter = this.getProviderAdapter(connection.provider);
      const result = await adapter.fetchEvents(
        connection.credentialsRef,
        connection.syncCursorJson,
      );

      await this.upsertEvents(
        connection.id,
        connection.userId,
        result.events,
      );

      await this.prismaService.calendarConnection.update({
        where: { id: connection_id },
        data: {
          status: CalendarConnectionStatus.ACTIVE,
          lastSyncedAt: new Date(),
          lastErrorCode: null,
          syncCursorJson: result.next_sync_cursor
            ? JSON.parse(JSON.stringify(result.next_sync_cursor))
            : undefined,
        },
      });

      this.logger.log(
        `Sync completed for ${connection_id}: ${result.events.length} events`,
      );
    } catch (error) {
      const errorCode =
        error instanceof Error ? error.message.slice(0, 64) : 'UNKNOWN_ERROR';

      await this.markConnectionError(connection_id, errorCode);
      throw error;
    }
  }

  private async upsertEvents(
    connectionId: string,
    userId: string,
    events: ProviderEvent[],
  ): Promise<void> {
    const now = new Date();

    for (const event of events) {
      await this.prismaService.calendarEvent.upsert({
        where: {
          connectionId_providerEventId: {
            connectionId,
            providerEventId: event.provider_event_id,
          },
        },
        create: {
          userId,
          connectionId,
          providerEventId: event.provider_event_id,
          calendarName: event.calendar_name ?? null,
          title: event.title,
          description: event.description ?? null,
          location: event.location ?? null,
          startsAt: new Date(event.starts_at),
          endsAt: new Date(event.ends_at),
          isAllDay: event.is_all_day,
          eventStatus: CalendarEventStatus[event.event_status],
          providerUpdatedAt: event.provider_updated_at
            ? new Date(event.provider_updated_at)
            : null,
          lastSyncedAt: now,
          rawPayloadJson: event.raw_payload
            ? JSON.parse(JSON.stringify(event.raw_payload))
            : undefined,
        },
        update: {
          calendarName: event.calendar_name ?? null,
          title: event.title,
          description: event.description ?? null,
          location: event.location ?? null,
          startsAt: new Date(event.starts_at),
          endsAt: new Date(event.ends_at),
          isAllDay: event.is_all_day,
          eventStatus: CalendarEventStatus[event.event_status],
          providerUpdatedAt: event.provider_updated_at
            ? new Date(event.provider_updated_at)
            : null,
          lastSyncedAt: now,
          rawPayloadJson: event.raw_payload
            ? JSON.parse(JSON.stringify(event.raw_payload))
            : undefined,
        },
      });
    }
  }

  private async markConnectionError(
    connectionId: string,
    errorCode: string,
  ): Promise<void> {
    await this.prismaService.calendarConnection.update({
      where: { id: connectionId },
      data: {
        status: CalendarConnectionStatus.ERROR,
        lastErrorCode: errorCode,
      },
    });
  }

  private getProviderAdapter(provider: string): CalendarProviderAdapter {
    switch (provider) {
      case 'GOOGLE':
        return this.getGoogleAdapter();
      default:
        return this.getStubAdapter();
    }
  }

  private getGoogleAdapter(): CalendarProviderAdapter {
    // Google Calendar API adapter
    // In production, this would use googleapis SDK with OAuth2 credentials
    // For now, return stub that can be replaced with real implementation
    const isDevBridge =
      this.configService.get<string>('CALENDAR_ENABLE_DEV_OAUTH_BRIDGE') ===
      'true';

    if (isDevBridge) {
      return this.getStubAdapter();
    }

    // Real Google adapter would be injected here
    return this.getStubAdapter();
  }

  private getStubAdapter(): CalendarProviderAdapter {
    return {
      async fetchEvents(): Promise<SyncResult> {
        return { events: [], next_sync_cursor: null };
      },
    };
  }

  private getRedisUrl(): string {
    return (
      this.configService.get<string>('REDIS_URL') ??
      'redis://127.0.0.1:6379'
    );
  }
}
