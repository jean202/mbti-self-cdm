import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CalendarConnectionStatus,
  CalendarProvider,
  Prisma,
  OnboardingStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';

import { toOnboardingState } from '../../common/utils/onboarding-state.util';
import { QueueService } from '../../infra/queue/queue.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { CompleteCalendarOAuthCallbackDto } from './dto/complete-calendar-oauth-callback.dto';
import { ListCalendarEventsQueryDto } from './dto/list-calendar-events-query.dto';
import { StartCalendarOAuthDto } from './dto/start-calendar-oauth.dto';

type OAuthProviderConfig = {
  authorizeUrl: string;
  clientIdEnvKey: string;
  callbackUriEnvKey: string;
  scopes: string[];
  extraParams?: Record<string, string>;
};

type StoredCalendarOAuthState = {
  flow_id: string;
  user_id: string;
  provider: CalendarProvider;
  redirect_uri: string;
  callback_uri: string;
  created_at: string;
};

const OAUTH_PROVIDER_CONFIG: Partial<Record<CalendarProvider, OAuthProviderConfig>> = {
  [CalendarProvider.GOOGLE]: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    clientIdEnvKey: 'CALENDAR_GOOGLE_CLIENT_ID',
    callbackUriEnvKey: 'CALENDAR_GOOGLE_CALLBACK_URI',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    extraParams: {
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
    },
  },
};

const CALENDAR_PROVIDER_LABELS: Record<CalendarProvider, string> = {
  [CalendarProvider.GOOGLE]: 'Google Calendar',
  [CalendarProvider.APPLE]: 'Apple Calendar',
  [CalendarProvider.OTHER]: 'Calendar',
};

@Injectable()
export class CalendarService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly queueService: QueueService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async startOAuthConnection(userId: string, input: StartCalendarOAuthDto) {
    await this.ensureUserExists(userId);

    const providerConfig = OAUTH_PROVIDER_CONFIG[input.provider];

    if (!providerConfig) {
      throw new BadRequestException(
        `${input.provider} calendar OAuth start is not supported yet.`,
      );
    }

    const clientId =
      this.configService.get<string>(providerConfig.clientIdEnvKey) ??
      'dev-google-calendar-client-id';
    const callbackUri =
      this.configService.get<string>(providerConfig.callbackUriEnvKey) ??
      this.buildDefaultCallbackUri(input.provider);

    const flowId = randomUUID();
    const stateKey = this.getOAuthStateKey(input.provider, flowId);
    const now = new Date();
    const statePayload = {
      flow_id: flowId,
      user_id: userId,
      provider: input.provider,
      redirect_uri: input.redirect_uri,
      callback_uri: callbackUri,
      created_at: now.toISOString(),
    };

    await this.redisService.getClient().set(
      stateKey,
      JSON.stringify(statePayload),
      'EX',
      this.getOAuthStateTtlSeconds(),
    );

    await this.prismaService.user.update({
      where: {
        id: userId,
      },
      data: {
        lastActiveAt: now,
      },
    });

    return {
      provider: input.provider,
      flow_id: flowId,
      authorize_url: this.buildAuthorizeUrl(
        providerConfig,
        clientId,
        callbackUri,
        flowId,
      ),
    };
  }

  async completeOAuthConnection(
    providerInput: string,
    input: CompleteCalendarOAuthCallbackDto,
  ) {
    const provider = this.normalizeProvider(providerInput);
    const stateKey = this.getOAuthStateKey(provider, input.state);
    const rawState = await this.redisService.getClient().get(stateKey);

    if (!rawState) {
      throw new BadRequestException({
        code: 'INVALID_CALENDAR_OAUTH_STATE',
        message: 'Calendar OAuth state was not found or expired.',
      });
    }

    const state = this.parseStoredOAuthState(rawState);

    if (state.provider !== provider) {
      await this.redisService.getClient().del(stateKey);

      throw new BadRequestException({
        code: 'CALENDAR_OAUTH_PROVIDER_MISMATCH',
        message: 'Calendar OAuth provider does not match the stored state.',
      });
    }

    if (input.error?.trim()) {
      await this.redisService.getClient().del(stateKey);

      return this.buildOAuthRedirectResult(state, provider, {
        success: false,
        error_code: 'CALENDAR_OAUTH_DENIED',
        error_description:
          input.error_description?.trim() ??
          `Provider returned ${input.error.trim()}.`,
      });
    }

    const providerConfig = OAUTH_PROVIDER_CONFIG[provider];

    if (!providerConfig) {
      await this.redisService.getClient().del(stateKey);

      return this.buildOAuthRedirectResult(state, provider, {
        success: false,
        error_code: 'CALENDAR_OAUTH_NOT_SUPPORTED',
        error_description: `${provider} calendar OAuth callback is not supported yet.`,
      });
    }

    const user = await this.prismaService.user.findUnique({
      where: {
        id: state.user_id,
      },
      select: {
        id: true,
        onboardingStatus: true,
      },
    });

    if (!user) {
      await this.redisService.getClient().del(stateKey);
      throw new NotFoundException('User was not found.');
    }

    if (
      user.onboardingStatus === OnboardingStatus.AUTH_ONLY ||
      user.onboardingStatus === OnboardingStatus.MBTI_PENDING
    ) {
      await this.redisService.getClient().del(stateKey);

      return this.buildOAuthRedirectResult(state, provider, {
        success: false,
        error_code: 'CALENDAR_ONBOARDING_NOT_READY',
        error_description:
          'Calendar connection is available only after MBTI confirmation.',
      });
    }

    const authorizationCode = input.code?.trim();

    if (!authorizationCode && !this.isDevOAuthBridgeEnabled()) {
      await this.redisService.getClient().del(stateKey);

      return this.buildOAuthRedirectResult(state, provider, {
        success: false,
        error_code: 'CALENDAR_OAUTH_CODE_REQUIRED',
        error_description:
          'Provider callback did not include an authorization code.',
      });
    }

    const now = new Date();
    const providerAccountId = this.readProviderAccountId(
      provider,
      state.user_id,
      input.provider_account_id,
    );
    const accountLabel = this.readAccountLabel(provider, input.account_label);
    const nextOnboardingStatus =
      user.onboardingStatus === OnboardingStatus.CALENDAR_PENDING
        ? OnboardingStatus.COMPLETED
        : user.onboardingStatus;
    const connection = await this.prismaService.$transaction(async (tx) => {
      const savedConnection = await tx.calendarConnection.upsert({
        where: {
          userId_provider_providerAccountId: {
            userId: state.user_id,
            provider,
            providerAccountId,
          },
        },
        create: {
          userId: state.user_id,
          provider,
          providerAccountId,
          accountLabel,
          status: CalendarConnectionStatus.ACTIVE,
          scopesJson: providerConfig.scopes,
          syncCursorJson: {
            oauth_flow_id: state.flow_id,
            initial_sync_required: true,
            authorization_code_received: Boolean(authorizationCode),
          } as Prisma.InputJsonValue,
          connectedAt: now,
        },
        update: {
          accountLabel,
          status: CalendarConnectionStatus.ACTIVE,
          credentialsRef: null,
          scopesJson: providerConfig.scopes,
          syncCursorJson: {
            oauth_flow_id: state.flow_id,
            initial_sync_required: true,
            authorization_code_received: Boolean(authorizationCode),
          } as Prisma.InputJsonValue,
          connectedAt: now,
          revokedAt: null,
          lastErrorCode: null,
        },
        select: {
          id: true,
          status: true,
        },
      });

      await tx.user.update({
        where: {
          id: state.user_id,
        },
        data: {
          onboardingStatus: nextOnboardingStatus,
          lastActiveAt: now,
        },
      });

      return savedConnection;
    });

    await this.redisService.getClient().del(stateKey);

    return this.buildOAuthRedirectResult(state, provider, {
      success: true,
      connection_id: connection.id,
      status: connection.status,
    });
  }

  async getConnections(userId: string) {
    await this.ensureUserExists(userId);

    const connections = await this.prismaService.calendarConnection.findMany({
      where: {
        userId,
      },
      orderBy: [{ connectedAt: 'desc' }],
      select: {
        id: true,
        provider: true,
        accountLabel: true,
        status: true,
        lastSyncedAt: true,
      },
    });

    return connections.map((connection) => ({
      id: connection.id,
      provider: connection.provider,
      account_label: connection.accountLabel,
      status: connection.status,
      last_synced_at: connection.lastSyncedAt?.toISOString() ?? null,
    }));
  }

  async syncConnection(userId: string, connectionId: string) {
    const connection = await this.findConnectionOrThrow(userId, connectionId);

    if (connection.status === CalendarConnectionStatus.REVOKED) {
      throw new ConflictException('Revoked calendar connections cannot be synced.');
    }

    const now = new Date();
    const updatedConnection = await this.prismaService.calendarConnection.update({
      where: {
        id: connection.id,
      },
      data: {
        status: CalendarConnectionStatus.SYNCING,
        lastErrorCode: null,
      },
      select: {
        id: true,
        status: true,
      },
    });

    const queue = this.queueService.getQueue('calendar-sync');
    await queue.add('sync-connection', {
      connection_id: connection.id,
      user_id: userId,
      provider: connection.provider,
      requested_at: now.toISOString(),
    });

    await this.prismaService.user.update({
      where: {
        id: userId,
      },
      data: {
        lastActiveAt: now,
      },
    });

    return {
      connection_id: updatedConnection.id,
      status: updatedConnection.status,
      queued: true,
    };
  }

  async revokeConnection(userId: string, connectionId: string) {
    const connection = await this.findConnectionOrThrow(userId, connectionId);
    const now = new Date();
    const updatedConnection = await this.prismaService.calendarConnection.update({
      where: {
        id: connection.id,
      },
      data: {
        status: CalendarConnectionStatus.REVOKED,
        revokedAt: now,
        credentialsRef: null,
        syncCursorJson: Prisma.JsonNull,
        lastErrorCode: null,
      },
      select: {
        id: true,
        status: true,
      },
    });

    await this.prismaService.user.update({
      where: {
        id: userId,
      },
      data: {
        lastActiveAt: now,
      },
    });

    return {
      connection_id: updatedConnection.id,
      status: updatedConnection.status,
    };
  }

  async listEvents(userId: string, query: ListCalendarEventsQueryDto) {
    await this.ensureUserExists(userId);

    const from = new Date(query.from);
    const to = new Date(query.to);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('from and to must be valid ISO timestamps.');
    }

    if (from >= to) {
      throw new BadRequestException('from must be earlier than to.');
    }

    if (query.connection_id) {
      await this.findConnectionOrThrow(userId, query.connection_id);
    }

    const events = await this.prismaService.calendarEvent.findMany({
      where: {
        userId,
        connectionId: query.connection_id ?? undefined,
        endsAt: {
          gt: from,
        },
        startsAt: {
          lt: to,
        },
      },
      orderBy: [{ startsAt: 'asc' }, { endsAt: 'asc' }],
      select: {
        id: true,
        connectionId: true,
        title: true,
        startsAt: true,
        endsAt: true,
        isAllDay: true,
        eventStatus: true,
        calendarName: true,
      },
    });

    return events.map((event) => ({
      id: event.id,
      connection_id: event.connectionId,
      title: event.title,
      starts_at: event.startsAt.toISOString(),
      ends_at: event.endsAt.toISOString(),
      is_all_day: event.isAllDay,
      event_status: event.eventStatus,
      calendar_name: event.calendarName,
    }));
  }

  async skipCalendarOnboarding(userId: string) {
    const user = await this.prismaService.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        onboardingStatus: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User was not found.');
    }

    if (
      user.onboardingStatus === OnboardingStatus.AUTH_ONLY ||
      user.onboardingStatus === OnboardingStatus.MBTI_PENDING
    ) {
      throw new ConflictException(
        'Calendar onboarding cannot be skipped before MBTI is confirmed.',
      );
    }

    const now = new Date();

    await this.prismaService.user.update({
      where: {
        id: userId,
      },
      data: {
        onboardingStatus: OnboardingStatus.COMPLETED,
        lastActiveAt: now,
      },
    });

    return {
      onboarding: toOnboardingState(OnboardingStatus.COMPLETED),
    };
  }

  private buildAuthorizeUrl(
    providerConfig: OAuthProviderConfig,
    clientId: string,
    callbackUri: string,
    flowId: string,
  ): string {
    const url = new URL(providerConfig.authorizeUrl);

    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', callbackUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', providerConfig.scopes.join(' '));
    url.searchParams.set('state', flowId);

    for (const [key, value] of Object.entries(providerConfig.extraParams ?? {})) {
      url.searchParams.set(key, value);
    }

    return url.toString();
  }

  private buildOAuthRedirectResult(
    state: StoredCalendarOAuthState,
    provider: CalendarProvider,
    input: {
      success: boolean;
      connection_id?: string;
      status?: CalendarConnectionStatus;
      error_code?: string;
      error_description?: string;
    },
  ) {
    const redirectTo = this.buildClientRedirectUri(state.redirect_uri, {
      calendar_oauth_status: input.success ? 'success' : 'failed',
      provider,
      flow_id: state.flow_id,
      connection_id: input.connection_id,
      error_code: input.error_code,
      error_description: input.error_description,
    });

    return {
      success: input.success,
      provider,
      flow_id: state.flow_id,
      connection_id: input.connection_id ?? null,
      status: input.status ?? null,
      error_code: input.error_code ?? null,
      error_description: input.error_description ?? null,
      redirect_to: redirectTo,
    };
  }

  private buildClientRedirectUri(
    redirectUri: string,
    params: Record<string, string | undefined>,
  ): string {
    const url = new URL(redirectUri);

    for (const [key, value] of Object.entries(params)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }

  private getOAuthStateKey(provider: CalendarProvider, flowId: string): string {
    return `oauth_state:${provider}:${flowId}`;
  }

  private buildDefaultCallbackUri(provider: CalendarProvider): string {
    const configuredBaseUrl = this.configService
      .get<string>('API_BASE_URL')
      ?.replace(/\/$/, '');

    if (configuredBaseUrl) {
      return `${configuredBaseUrl}/v1/internal/calendar/oauth/${provider.toLowerCase()}/callback`;
    }

    const host = this.configService.get<string>('HOST') ?? '127.0.0.1';
    const port = this.configService.get<string>('PORT') ?? '3000';

    return `http://${host}:${port}/v1/internal/calendar/oauth/${provider.toLowerCase()}/callback`;
  }

  private getOAuthStateTtlSeconds(): number {
    const configured = Number(
      this.configService.get<string>('CALENDAR_OAUTH_STATE_TTL_SECONDS') ?? '600',
    );

    return Number.isFinite(configured) && configured > 0 ? configured : 600;
  }

  private isDevOAuthBridgeEnabled(): boolean {
    const value =
      this.configService.get<string>('CALENDAR_ENABLE_DEV_OAUTH_BRIDGE') ??
      'true';

    return value.toLowerCase() !== 'false';
  }

  private normalizeProvider(providerInput: string): CalendarProvider {
    const normalized = providerInput.trim().toUpperCase();

    if (!Object.values(CalendarProvider).includes(normalized as CalendarProvider)) {
      throw new BadRequestException('Unsupported calendar provider.');
    }

    return normalized as CalendarProvider;
  }

  private parseStoredOAuthState(rawState: string): StoredCalendarOAuthState {
    let parsed: unknown;

    try {
      parsed = JSON.parse(rawState);
    } catch {
      throw new BadRequestException({
        code: 'INVALID_CALENDAR_OAUTH_STATE',
        message: 'Calendar OAuth state payload is invalid.',
      });
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as StoredCalendarOAuthState).flow_id !== 'string' ||
      typeof (parsed as StoredCalendarOAuthState).user_id !== 'string' ||
      typeof (parsed as StoredCalendarOAuthState).provider !== 'string' ||
      typeof (parsed as StoredCalendarOAuthState).redirect_uri !== 'string' ||
      typeof (parsed as StoredCalendarOAuthState).callback_uri !== 'string'
    ) {
      throw new BadRequestException({
        code: 'INVALID_CALENDAR_OAUTH_STATE',
        message: 'Calendar OAuth state payload is malformed.',
      });
    }

    return parsed as StoredCalendarOAuthState;
  }

  private readProviderAccountId(
    provider: CalendarProvider,
    userId: string,
    providerAccountId?: string,
  ): string {
    const normalized = providerAccountId?.trim();

    if (normalized) {
      return normalized;
    }

    return `dev-${provider.toLowerCase()}-${userId}`;
  }

  private readAccountLabel(
    provider: CalendarProvider,
    accountLabel?: string,
  ): string {
    const normalized = accountLabel?.trim();

    if (normalized) {
      return normalized;
    }

    return CALENDAR_PROVIDER_LABELS[provider];
  }

  private async ensureUserExists(userId: string) {
    const user = await this.prismaService.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User was not found.');
    }
  }

  private async findConnectionOrThrow(userId: string, connectionId: string) {
    const connection = await this.prismaService.calendarConnection.findFirst({
      where: {
        id: connectionId,
        userId,
      },
      select: {
        id: true,
        provider: true,
        status: true,
      },
    });

    if (!connection) {
      throw new NotFoundException('Calendar connection was not found.');
    }

    return connection;
  }
}
