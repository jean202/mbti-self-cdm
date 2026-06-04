import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CalendarConnectionStatus,
  CalendarEventStatus,
  TaskStatus,
  TodayFocusStatus,
} from '@prisma/client';

import {
  buildUtcDayRangeForTimezone,
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
    empty_state_prompt?: string;
    overload_prompt?: string;
  };
  reminders?: {
    samples?: string[];
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
  reminder_tone?: {
    tone_key?: string;
    intensity_floor?: string;
    intensity_ceiling?: string;
    cadence_bias?: string;
  };
}

@Injectable()
export class HomeService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly typeProfileLoaderService: TypeProfileLoaderService,
  ) {}

  async getHome(userId: string, requestedLocalDate?: string) {
    const now = new Date();
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        locale: true,
        timezone: true,
        lastActiveAt: true,
        mbtiProfile: {
          select: {
            typeCode: true,
            profileVersion: true,
          },
        },
        calendarConnections: {
          where: {
            status: {
              not: CalendarConnectionStatus.REVOKED,
            },
          },
          orderBy: {
            connectedAt: 'desc',
          },
          select: {
            id: true,
            status: true,
            lastSyncedAt: true,
            lastErrorCode: true,
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
    const calendarRange = buildUtcDayRangeForTimezone(
      localDate,
      user.timezone,
    );
    const connectionIds = user.calendarConnections.map((connection) => connection.id);
    const primaryCalendarConnection = user.calendarConnections[0];

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
              engagementNudge: null,
            }),
      ]);
    const engagementNudge = this.selectEngagementNudge({
      profilePresentation,
      typeCode: user.mbtiProfile?.typeCode ?? null,
      previousLastActiveAt: user.lastActiveAt,
      now,
      hasTodayFocus: Boolean(todayFocus),
      topTaskCount: topTasks.length,
      hasCalendarConnection: connectionIds.length > 0,
    });

    await this.prismaService.user.update({
      where: { id: userId },
      data: { lastActiveAt: now },
    });

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
        connection_id: primaryCalendarConnection?.id ?? null,
        connection_status: primaryCalendarConnection?.status ?? null,
        last_synced_at:
          primaryCalendarConnection?.lastSyncedAt?.toISOString() ?? null,
        last_error_code: primaryCalendarConnection?.lastErrorCode ?? null,
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
      engagement_nudge: engagementNudge,
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
    engagementNudge: {
      tone_key: string | null;
      reminder_intensity_floor: string | null;
      reminder_intensity_ceiling: string | null;
      empty_state_prompt: string | null;
      reminder_samples: string[];
      recovery_prompt: string | null;
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
    const reminderTone = profile.reminder_tone;

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
      engagementNudge:
        copy || reminderTone
          ? {
              tone_key: reminderTone?.tone_key ?? null,
              reminder_intensity_floor: reminderTone?.intensity_floor ?? null,
              reminder_intensity_ceiling: reminderTone?.intensity_ceiling ?? null,
              empty_state_prompt: copy?.home?.empty_state_prompt ?? null,
              reminder_samples: copy?.reminders?.samples ?? [],
              recovery_prompt: copy?.home?.overload_prompt ?? recoveryBody ?? null,
            }
          : null,
    };
  }

  private selectEngagementNudge(input: {
    profilePresentation: Awaited<
      ReturnType<HomeService['buildProfilePresentation']>
    >;
    typeCode: string | null;
    previousLastActiveAt: Date | null;
    now: Date;
    hasTodayFocus: boolean;
    topTaskCount: number;
    hasCalendarConnection: boolean;
  }) {
    const {
      profilePresentation,
      typeCode,
      previousLastActiveAt,
      now,
      hasTodayFocus,
      topTaskCount,
      hasCalendarConnection,
    } = input;
    const nudgeSource = profilePresentation.engagementNudge;

    if (!typeCode || !nudgeSource) {
      return null;
    }

    const inactiveDays = previousLastActiveAt
      ? Math.floor(
          (now.getTime() - previousLastActiveAt.getTime()) /
            (24 * 60 * 60 * 1000),
        )
      : 0;
    const isEmptySetup =
      !hasTodayFocus && topTaskCount === 0 && !hasCalendarConnection;
    const isReturningAfterBreak = inactiveDays >= 3;

    if (!isEmptySetup && !isReturningAfterBreak) {
      return null;
    }

    const state = isReturningAfterBreak
      ? 'RETURNING_AFTER_BREAK'
      : 'EMPTY_SETUP';
    const typeNudge = this.typeSpecificNudge(
      typeCode,
      state,
      nudgeSource.empty_state_prompt,
      nudgeSource.reminder_samples,
      nudgeSource.recovery_prompt,
    );

    return {
      state,
      type_code: typeCode,
      inactive_days: inactiveDays,
      tone_key: nudgeSource.tone_key,
      intensity:
        state === 'RETURNING_AFTER_BREAK'
          ? this.deEscalateIntensity(nudgeSource.reminder_intensity_floor)
          : nudgeSource.reminder_intensity_floor ?? 'low',
      cadence_bias: state === 'RETURNING_AFTER_BREAK' ? 'gentle' : 'adaptive',
      title: typeNudge.title,
      body: typeNudge.body,
      action_label: typeNudge.actionLabel,
      suggested_entry: typeNudge.suggestedEntry,
    };
  }

  private typeSpecificNudge(
    typeCode: string,
    state: 'EMPTY_SETUP' | 'RETURNING_AFTER_BREAK',
    emptyStatePrompt: string | null,
    reminderSamples: string[],
    recoveryPrompt: string | null,
  ) {
    if (state === 'RETURNING_AFTER_BREAK') {
      if (typeCode === 'ESTJ') {
        return {
          title: '재촉보다 재정렬이 먼저입니다',
          body:
            '평소처럼 정리하지 못할 정도였다면 무슨 일이 있었을 가능성이 큽니다. 새 계획을 더 얹지 말고, 지금 부담이 가장 큰 하나만 확인하세요.',
          actionLabel: '부담 큰 일 하나만 적기',
          suggestedEntry: 'quick_capture',
        };
      }

      if (typeCode === 'INFP') {
        return {
          title: '작게 다시 시작해도 됩니다',
          body:
            '오래 비어 있어도 괜찮아요. 완벽한 계획보다 지금 마음에 남아 있는 한 줄이면 다시 이어갈 수 있습니다.',
          actionLabel: '작은 한 줄 남기기',
          suggestedEntry: 'quick_capture',
        };
      }

      if (typeCode === 'INTJ') {
        return {
          title: '공백이 길었습니다',
          body:
            '감정 판단은 빼고 현재 병목 하나와 다음 행동 하나만 정리하세요. 계획은 그다음에 다시 세우면 됩니다.',
          actionLabel: '병목 하나 정리하기',
          suggestedEntry: 'quick_capture',
        };
      }

      if (this.isThinkingType(typeCode)) {
        return {
          title: '현재 상태만 다시 잡으세요',
          body:
            reminderSamples[0] ??
            '긴 공백 뒤에는 큰 계획보다 현재 제약과 다음 행동 하나를 확인하는 편이 낫습니다.',
          actionLabel: '다음 행동 하나 적기',
          suggestedEntry: 'quick_capture',
        };
      }

      if (this.isFeelingType(typeCode)) {
        return {
          title: '다시 이어갈 작은 단서',
          body:
            reminderSamples[0] ??
            '비어 있던 시간을 자책하지 말고, 지금 신경 쓰이는 일 하나부터 가볍게 남겨보세요.',
          actionLabel: '가볍게 남기기',
          suggestedEntry: 'quick_capture',
        };
      }

      return {
        title: '다시 시작할 작은 기준',
        body:
          recoveryPrompt ??
          '오래 비어 있었다면 오늘은 크게 밀지 말고 가장 작은 다음 행동 하나만 정리해보세요.',
        actionLabel: '하나만 적기',
        suggestedEntry: 'quick_capture',
      };
    }

    if (typeCode === 'INTJ') {
      return {
        title: '빈 상태입니다',
        body: '목표 하나, 제약 하나, 다음 행동 하나만 입력하세요.',
        actionLabel: '다음 행동 입력',
        suggestedEntry: 'quick_capture',
      };
    }

    return {
      title: '오늘의 시작점을 잡아보세요',
      body:
        emptyStatePrompt ??
        reminderSamples[0] ??
        '아직 설정된 내용이 없습니다. 지금 떠오르는 일 하나만 남겨도 홈이 맞춰지기 시작합니다.',
      actionLabel: '첫 항목 남기기',
      suggestedEntry: 'quick_capture',
    };
  }

  private deEscalateIntensity(intensity: string | null) {
    if (intensity === 'high' || intensity === 'medium') {
      return 'low';
    }

    return intensity ?? 'low';
  }

  private isThinkingType(typeCode: string) {
    return typeCode[2] === 'T';
  }

  private isFeelingType(typeCode: string) {
    return typeCode[2] === 'F';
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
