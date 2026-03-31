import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CalendarConnectionStatus,
  CalendarEventStatus,
  IdeaStatus,
  TaskStatus,
  TodayFocusStatus,
} from '@prisma/client';

import {
  formatLocalDate,
  parseLocalDate,
  resolveRequestedLocalDate,
} from '../../common/utils/local-date.util';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { TypeProfileLoaderService } from '../type-profiles/type-profile-loader.service';
import { PlanBacklogQueryDto } from './dto/plan-backlog-query.dto';
import { PlanWeekQueryDto } from './dto/plan-week-query.dto';
import { ReorderTasksDto } from './dto/reorder-tasks.dto';

interface TypeProfileDocument {
  planning_style?: {
    style_key?: string;
    today_strategy?: string;
    week_strategy?: string;
    backlog_strategy?: string;
    default_sort?: string[];
  };
  copy?: Record<
    string,
    {
      plan?: {
        today_prompt?: string;
        week_prompt?: string;
        backlog_prompt?: string;
      };
    }
  >;
}

interface PlanPersonalization {
  planning_style: {
    style_key: string;
    strategy: string | null;
    default_sort: string[];
  } | null;
  prompt: string | null;
}

@Injectable()
export class PlanService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly typeProfileLoaderService: TypeProfileLoaderService,
  ) {}

  async getToday(userId: string, requestedLocalDate?: string) {
    const user = await this.findUserOrThrow(userId);

    const localDate = resolveRequestedLocalDate(
      requestedLocalDate,
      user.timezone,
    );
    const localDateValue = parseLocalDate(localDate);

    const [todayFocus, tasks, personalization] = await Promise.all([
      this.prismaService.todayFocus.findFirst({
        where: {
          userId,
          localDate: localDateValue,
          status: TodayFocusStatus.ACTIVE,
        },
        select: {
          id: true,
          localDate: true,
          title: true,
          note: true,
          status: true,
        },
      }),
      this.prismaService.task.findMany({
        where: {
          userId,
          localDueDate: localDateValue,
          status: { not: TaskStatus.ARCHIVED },
        },
        orderBy: [
          { sortOrder: 'asc' },
          { dueAt: 'asc' },
          { updatedAt: 'desc' },
        ],
      }),
      this.loadPlanPersonalization(user, 'today'),
    ]);

    return {
      local_date: localDate,
      personalization,
      today_focus: todayFocus
        ? {
            id: todayFocus.id,
            local_date: formatLocalDate(todayFocus.localDate),
            title: todayFocus.title,
            note: todayFocus.note,
            status: todayFocus.status,
          }
        : null,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        note: t.note,
        status: t.status,
        source_type: t.sourceType,
        due_at: t.dueAt?.toISOString() ?? null,
        local_due_date: t.localDueDate
          ? formatLocalDate(t.localDueDate)
          : null,
        energy_estimate: t.energyEstimate,
        sort_order: t.sortOrder,
        completed_at: t.completedAt?.toISOString() ?? null,
      })),
    };
  }

  async getWeek(userId: string, query: PlanWeekQueryDto) {
    const user = await this.findUserOrThrow(userId);

    const weekStart = parseLocalDate(query.week_start);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

    // Get active calendar connection IDs
    const connections = await this.prismaService.calendarConnection.findMany({
      where: {
        userId,
        status: {
          in: [
            CalendarConnectionStatus.ACTIVE,
            CalendarConnectionStatus.SYNCING,
          ],
        },
      },
      select: { id: true },
    });
    const connectionIds = connections.map((c) => c.id);

    const [tasks, calendarEvents, personalization] = await Promise.all([
      this.prismaService.task.findMany({
        where: {
          userId,
          localDueDate: {
            gte: weekStart,
            lt: weekEnd,
          },
          status: { not: TaskStatus.ARCHIVED },
        },
        orderBy: [
          { localDueDate: 'asc' },
          { sortOrder: 'asc' },
          { dueAt: 'asc' },
        ],
      }),
      connectionIds.length === 0
        ? Promise.resolve([])
        : this.prismaService.calendarEvent.findMany({
            where: {
              userId,
              connectionId: { in: connectionIds },
              startsAt: {
                gte: weekStart,
                lt: weekEnd,
              },
              eventStatus: {
                not: CalendarEventStatus.CANCELLED,
              },
            },
            orderBy: { startsAt: 'asc' },
          }),
      this.loadPlanPersonalization(user, 'week'),
    ]);

    return {
      week_start: query.week_start,
      personalization,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        source_type: t.sourceType,
        due_at: t.dueAt?.toISOString() ?? null,
        local_due_date: t.localDueDate
          ? formatLocalDate(t.localDueDate)
          : null,
        energy_estimate: t.energyEstimate,
        sort_order: t.sortOrder,
        completed_at: t.completedAt?.toISOString() ?? null,
      })),
      calendar_events: calendarEvents.map((e) => ({
        id: e.id,
        title: e.title,
        starts_at: e.startsAt.toISOString(),
        ends_at: e.endsAt.toISOString(),
        is_all_day: e.isAllDay,
        event_status: e.eventStatus,
        location: e.location,
      })),
    };
  }

  async getBacklog(userId: string, query: PlanBacklogQueryDto) {
    const user = await this.findUserOrThrow(userId);
    const limit = query.limit ?? 30;

    const cursorWhere = query.cursor
      ? { id: { gt: query.cursor } }
      : {};

    const [tasks, ideas, personalization] = await Promise.all([
      this.prismaService.task.findMany({
        where: {
          userId,
          localDueDate: null,
          status: {
            in: [TaskStatus.INBOX, TaskStatus.PLANNED],
          },
          ...cursorWhere,
        },
        orderBy: [{ createdAt: 'desc' }],
        take: limit,
      }),
      this.prismaService.idea.findMany({
        where: {
          userId,
          status: IdeaStatus.ACTIVE,
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: limit,
      }),
      this.loadPlanPersonalization(user, 'backlog'),
    ]);

    const nextCursor =
      tasks.length === limit ? tasks[tasks.length - 1]?.id : null;

    return {
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        note: t.note,
        status: t.status,
        source_type: t.sourceType,
        energy_estimate: t.energyEstimate,
        created_at: t.createdAt.toISOString(),
      })),
      ideas: ideas.map((i) => ({
        id: i.id,
        title: i.title,
        note: i.note,
        tags: i.tagsJson as string[] | null,
        created_at: i.createdAt.toISOString(),
      })),
      personalization,
      next_cursor: nextCursor,
    };
  }

  async reorderTasks(userId: string, input: ReorderTasksDto) {
    const taskIds = input.items.map((item) => item.task_id);

    // Verify all tasks belong to user
    const existingTasks = await this.prismaService.task.findMany({
      where: {
        id: { in: taskIds },
        userId,
      },
      select: { id: true },
    });

    const existingIds = new Set(existingTasks.map((t) => t.id));
    const missingIds = taskIds.filter((id) => !existingIds.has(id));

    if (missingIds.length > 0) {
      throw new NotFoundException(
        `Tasks not found: ${missingIds.join(', ')}`,
      );
    }

    await this.prismaService.$transaction(
      input.items.map((item) =>
        this.prismaService.task.update({
          where: { id: item.task_id },
          data: { sortOrder: item.sort_order },
        }),
      ),
    );

    return { updated_count: input.items.length };
  }

  private async findUserOrThrow(userId: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        timezone: true,
        locale: true,
        mbtiProfile: {
          select: {
            typeCode: true,
            profileVersion: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User was not found.');
    }

    return user;
  }

  private async loadPlanPersonalization(
    user: {
      locale: string;
      mbtiProfile: { typeCode: string; profileVersion: string | null } | null;
    },
    view: 'today' | 'week' | 'backlog',
  ): Promise<PlanPersonalization> {
    if (!user.mbtiProfile) {
      return { planning_style: null, prompt: null };
    }

    const profile = (await this.typeProfileLoaderService.getProfile(
      user.mbtiProfile.typeCode,
      user.mbtiProfile.profileVersion ?? undefined,
    )) as TypeProfileDocument | null;

    if (!profile) {
      return { planning_style: null, prompt: null };
    }

    const ps = profile.planning_style;
    const locale = user.locale ?? 'ko-KR';
    const copy =
      profile.copy?.[locale]?.plan ?? profile.copy?.['ko-KR']?.plan;

    const strategyMap = {
      today: ps?.today_strategy,
      week: ps?.week_strategy,
      backlog: ps?.backlog_strategy,
    };

    const promptMap = {
      today: copy?.today_prompt,
      week: copy?.week_prompt,
      backlog: copy?.backlog_prompt,
    };

    return {
      planning_style: ps?.style_key
        ? {
            style_key: ps.style_key,
            strategy: strategyMap[view] ?? null,
            default_sort: ps.default_sort ?? [],
          }
        : null,
      prompt: promptMap[view] ?? null,
    };
  }
}
