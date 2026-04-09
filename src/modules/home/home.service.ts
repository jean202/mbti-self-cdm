import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CalendarConnectionStatus,
  CalendarEventStatus,
  TaskStatus,
  TodayFocusStatus,
} from '@prisma/client';

import {
  buildUtcDayRange,
  formatLocalDate,
  parseLocalDate,
  resolveRequestedLocalDate,
} from '../../common/utils/local-date.util';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { TypeProfileLoaderService } from '../type-profiles/type-profile-loader.service';
import { UpsertTodayFocusDto } from './dto/upsert-today-focus.dto';

interface TypeProfileCopyLocale {
  type_title?: string;
  home?: {
    opening_prompt?: string;
  };
  recovery?: {
    card_title?: string;
    card_body?: string;
  };
}

interface TypeProfileDocument {
  copy?: Record<string, TypeProfileCopyLocale>;
  home_mode?: {
    mode_key?: string;
    default_interaction?: string;
    card_priority?: string[];
    empty_state_route?: string;
    overload_card_priority?: string;
  };
  stress_signals?: Array<{
    key?: string;
  }>;
}

@Injectable()
export class HomeService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly typeProfileLoaderService: TypeProfileLoaderService,
  ) {}

  async getHome(userId: string, requestedLocalDate?: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        locale: true,
        timezone: true,
        mbtiProfile: {
          select: {
            typeCode: true,
            profileVersion: true,
          },
        },
        calendarConnections: {
          where: {
            status: {
              in: [
                CalendarConnectionStatus.ACTIVE,
                CalendarConnectionStatus.SYNCING,
              ],
            },
          },
          select: {
            id: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User was not found.');
    }

    const localDate = resolveRequestedLocalDate(
      requestedLocalDate,
      user.timezone,
    );
    const localDateValue = parseLocalDate(localDate);
    const calendarRange = buildUtcDayRange(localDate);
    const connectionIds = user.calendarConnections.map((connection) => connection.id);

    const [todayFocus, topTasks, calendarItems, profilePresentation] =
      await Promise.all([
        this.prismaService.todayFocus.findUnique({
          where: {
            userId_localDate: {
              userId,
              localDate: localDateValue,
            },
          },
        }),
        this.prismaService.task.findMany({
          where: {
            userId,
            status: {
              in: [
                TaskStatus.INBOX,
                TaskStatus.PLANNED,
                TaskStatus.IN_PROGRESS,
              ],
            },
          },
          orderBy: [
            { sortOrder: 'asc' },
            { dueAt: 'asc' },
            { updatedAt: 'desc' },
          ],
          take: 3,
          select: {
            id: true,
            title: true,
            status: true,
            dueAt: true,
          },
        }),
        connectionIds.length === 0
          ? []
          : this.prismaService.calendarEvent.findMany({
              where: {
                userId,
                connectionId: {
                  in: connectionIds,
                },
                startsAt: {
                  gte: calendarRange.start,
                  lt: calendarRange.end,
                },
                eventStatus: {
                  not: CalendarEventStatus.CANCELLED,
                },
              },
              orderBy: {
                startsAt: 'asc',
              },
              take: 3,
              select: {
                id: true,
                title: true,
                startsAt: true,
                endsAt: true,
              },
            }),
        user.mbtiProfile
          ? this.buildProfilePresentation(
              user.locale,
              user.mbtiProfile.typeCode,
              user.mbtiProfile.profileVersion,
            )
          : Promise.resolve({
              personalizedPrompt: null,
              recoveryCard: null,
              homeMode: null,
            }),
      ]);

    return {
      today_focus: todayFocus
        ? {
            id: todayFocus.id,
            local_date: formatLocalDate(todayFocus.localDate),
            title: todayFocus.title,
            note: todayFocus.note,
            status: todayFocus.status,
          }
        : null,
      top_tasks: topTasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        due_at: task.dueAt?.toISOString() ?? null,
      })),
      calendar_summary: {
        has_connection: connectionIds.length > 0,
        items: calendarItems.map((item) => ({
          id: item.id,
          title: item.title,
          starts_at: item.startsAt.toISOString(),
          ends_at: item.endsAt.toISOString(),
        })),
      },
      trajectory_gap_card: null,
      personalized_prompt: profilePresentation.personalizedPrompt,
      recovery_card: profilePresentation.recoveryCard,
      home_mode: profilePresentation.homeMode,
    };
  }

  async upsertTodayFocus(userId: string, input: UpsertTodayFocusDto) {
    if (input.linked_task_id) {
      const linkedTask = await this.prismaService.task.findFirst({
        where: {
          id: input.linked_task_id,
          userId,
        },
        select: {
          id: true,
        },
      });

      if (!linkedTask) {
        throw new NotFoundException('Linked task was not found.');
      }
    }

    const localDateValue = parseLocalDate(input.local_date);

    const todayFocus = await this.prismaService.todayFocus.upsert({
      where: {
        userId_localDate: {
          userId,
          localDate: localDateValue,
        },
      },
      create: {
        userId,
        localDate: localDateValue,
        title: input.title,
        note: input.note ?? null,
        linkedTaskId: input.linked_task_id ?? null,
        status: TodayFocusStatus.ACTIVE,
      },
      update: {
        title: input.title,
        note: input.note ?? null,
        linkedTaskId: input.linked_task_id ?? null,
        status: TodayFocusStatus.ACTIVE,
      },
    });

    return {
      id: todayFocus.id,
      local_date: formatLocalDate(todayFocus.localDate),
      title: todayFocus.title,
      note: todayFocus.note,
      linked_task_id: todayFocus.linkedTaskId,
      status: todayFocus.status,
    };
  }

  private async buildProfilePresentation(
    locale: string,
    typeCode: string,
    profileVersion: string | null,
  ): Promise<{
    personalizedPrompt: {
      title: string;
      body: string;
    } | null;
    recoveryCard: {
      stress_signal_key: string | null;
      title: string;
      body: string;
    } | null;
    homeMode: {
      mode_key: string;
      default_interaction: string;
      card_priority: string[];
      empty_state_route: string | null;
      overload_card_priority: string | null;
    } | null;
  }> {
    const profile = (await this.typeProfileLoaderService.getProfile(
      typeCode,
      profileVersion ?? undefined,
    )) as TypeProfileDocument;
    const copy = this.pickLocaleCopy(profile.copy, locale);
    const openingPrompt = copy?.home?.opening_prompt;
    const recoveryTitle = copy?.recovery?.card_title;
    const recoveryBody = copy?.recovery?.card_body;
    const stressSignalKey = profile.stress_signals?.[0]?.key ?? null;

    const hm = profile.home_mode;

    return {
      personalizedPrompt: openingPrompt
        ? {
            title: copy?.type_title ?? typeCode,
            body: openingPrompt,
          }
        : null,
      recoveryCard:
        recoveryTitle && recoveryBody
          ? {
              stress_signal_key: stressSignalKey,
              title: recoveryTitle,
              body: recoveryBody,
            }
          : null,
      homeMode:
        hm?.mode_key && hm?.card_priority
          ? {
              mode_key: hm.mode_key,
              default_interaction: hm.default_interaction ?? 'prompted',
              card_priority: hm.card_priority,
              empty_state_route: hm.empty_state_route ?? null,
              overload_card_priority: hm.overload_card_priority ?? null,
            }
          : null,
    };
  }

  private pickLocaleCopy(
    copyMap: Record<string, TypeProfileCopyLocale> | undefined,
    locale: string,
  ): TypeProfileCopyLocale | undefined {
    if (!copyMap) {
      return undefined;
    }

    return copyMap[locale] ?? copyMap['ko-KR'] ?? Object.values(copyMap)[0];
  }
}
