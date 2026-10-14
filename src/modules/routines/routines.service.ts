import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  RoutineCadenceType,
  TaskSourceType,
  TaskStatus,
  type Routine,
  type Task,
  type User,
} from '@prisma/client';

import {
  buildUtcDayRangeForTimezone,
  formatLocalDate,
  parseLocalDate,
  resolveRequestedLocalDate,
} from '../../common/utils/local-date.util';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreateRoutineDto } from './dto/create-routine.dto';
import { isRecommendationWindow, type RecommendationWindow } from './dto/recommendation-window';
import { isScheduleDueAt } from './dto/schedule-routine.dto';
import { UpdateRecommendationWindowDto } from './dto/update-recommendation-window.dto';

type RoutineTaskSource = Pick<
  Task,
  | 'id'
  | 'title'
  | 'status'
  | 'sourceType'
  | 'localDueDate'
  | 'dueAt'
  | 'completedAt'
  | 'createdAt'
>;

type RoutineCadenceRule = {
  daysOfWeek?: number[];
  timesPerWeek?: number;
  recommendationWindow?: RecommendationWindow | null;
};

type WeeklyProgress = {
  doneCount: number;
  achieved: boolean;
  streak: number;
};

@Injectable()
export class RoutinesService {
  private readonly logger = new Logger(RoutinesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createRoutine(userId: string, dto: CreateRoutineDto) {
    this.logger.log(`Creating routine for user: ${userId}`);
    const hasDays = Array.isArray(dto.daysOfWeek) && dto.daysOfWeek.length > 0;
    const hasTimesPerWeek = dto.timesPerWeek !== undefined;

    if (hasDays === hasTimesPerWeek) {
      throw new BadRequestException(
        'Provide exactly one of daysOfWeek or timesPerWeek.',
      );
    }

    if (dto.recommendationWindow !== undefined && dto.recommendationWindow !== null
      && !isRecommendationWindow(dto.recommendationWindow)) {
      throw new BadRequestException('Invalid recommendationWindow.');
    }

    const cadencePayload = hasTimesPerWeek
      ? { timesPerWeek: dto.timesPerWeek }
      : { daysOfWeek: dto.daysOfWeek };

    return this.prisma.routine.create({
      data: {
        userId,
        name: dto.title,
        note: dto.note,
        cadenceType: hasTimesPerWeek
          ? RoutineCadenceType.CUSTOM
          : RoutineCadenceType.WEEKLY,
        isActive: dto.isActive ?? true,
        cadencePayloadJson: {
          ...cadencePayload,
          ...(dto.recommendationWindow !== undefined
            ? { recommendationWindow: dto.recommendationWindow }
            : {}),
        } as Prisma.InputJsonValue,
      },
    });
  }

  async updateRecommendationWindow(
    userId: string,
    routineId: string,
    dto: UpdateRecommendationWindowDto,
  ) {
    const window = dto?.recommendationWindow;
    if (window !== null && !isRecommendationWindow(window)) {
      throw new BadRequestException('Provide recommendationWindow as a valid window or null.');
    }

    const routine = await this.prisma.routine.findFirst({
      where: { id: routineId, userId },
    });
    if (!routine) {
      throw new NotFoundException('Routine was not found.');
    }

    const payload = {
      ...(routine.cadencePayloadJson as Prisma.JsonObject | null),
    };
    if (window === null) {
      delete payload.recommendationWindow;
    } else {
      payload.recommendationWindow = window;
    }

    return this.prisma.routine.update({
      where: { id: routineId, userId },
      data: { cadencePayloadJson: payload },
    });
  }

  async scheduleRoutine(userId: string, routineId: string, dueAt: string): Promise<Task> {
    if (!isScheduleDueAt(dueAt)) {
      throw new BadRequestException('dueAt must be a valid ISO 8601 timestamp with Z or a timezone offset.');
    }

    const scheduledAt = new Date(dueAt);

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { id: true, timezone: true },
          });
          if (!user) {
            throw new NotFoundException('User was not found.');
          }

          const routine = await tx.routine.findFirst({ where: { id: routineId, userId } });
          if (!routine) {
            throw new NotFoundException('Routine was not found.');
          }
          if (!routine.isActive) {
            throw new BadRequestException('Inactive routines cannot be scheduled.');
          }

          const localDate = this.formatDateInTimezone(scheduledAt, user.timezone);
          if (this.timesPerWeekOf(routine) === null && !this.isRoutineDueOn(routine, localDate)) {
            throw new BadRequestException('Routine is not due on the selected local date.');
          }

          const localDueDate = parseLocalDate(localDate);
          const existing = await tx.task.findFirst({
            where: { userId, title: routine.name, sourceType: TaskSourceType.ROUTINE, localDueDate },
          });
          if (existing) {
            if (existing.status === TaskStatus.DONE || existing.status === TaskStatus.ARCHIVED) {
              throw new BadRequestException('Completed or skipped routine tasks cannot be scheduled.');
            }
            return tx.task.update({
              where: { id: existing.id, userId },
              data: { dueAt: scheduledAt },
            });
          }

          return tx.task.create({
            data: {
              userId,
              title: routine.name,
              note: routine.note,
              status: TaskStatus.INBOX,
              sourceType: TaskSourceType.ROUTINE,
              localDueDate,
              dueAt: scheduledAt,
            },
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError)
          || error.code !== 'P2034' || attempt >= 2) {
          throw error;
        }
      }
    }
  }

  async getRoutines(userId: string, requestedDate?: string) {
    const user = await this.findUserOrThrow(userId);
    const localDate = resolveRequestedLocalDate(requestedDate, user.timezone);

    await this.ensureTodayTasks(userId, localDate, user.timezone);

    const routines = await this.prisma.routine.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return this.buildRoutineResponses(userId, user.timezone, localDate, routines);
  }

  async generateTodayTasks(userId: string, requestedDate?: string) {
    this.logger.log(`Checking routines to generate today's tasks for user: ${userId}`);
    const user = await this.findUserOrThrow(userId);
    const localDate = resolveRequestedLocalDate(requestedDate, user.timezone);

    const result = await this.ensureTodayTasks(userId, localDate, user.timezone);

    return { generated_count: result.generatedCount };
  }

  async skipTodayRoutine(userId: string, routineId: string, requestedDate?: string) {
    const user = await this.findUserOrThrow(userId);
    const localDate = resolveRequestedLocalDate(requestedDate, user.timezone);
    const routine = await this.prisma.routine.findFirst({
      where: { id: routineId, userId },
    });

    if (!routine) {
      throw new NotFoundException('Routine was not found.');
    }

    if (!this.isRoutineDueOn(routine, localDate)) {
      return {
        routine_id: routineId,
        local_date: localDate,
        skipped: false,
        reason: 'not_due_today',
      };
    }

    const localDueDate = parseLocalDate(localDate);
    const task =
      (await this.findRoutineTaskForDate(userId, routine.name, localDate)) ??
      (await this.createRoutineTask(userId, routine, localDate, user.timezone));

    if (task.status === TaskStatus.DONE) {
      return {
        routine_id: routineId,
        task_id: task.id,
        local_date: localDate,
        skipped: false,
        reason: 'already_done',
      };
    }

    const skippedTask = await this.prisma.task.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.ARCHIVED,
        localDueDate,
      },
    });

    return {
      routine_id: routineId,
      task_id: skippedTask.id,
      local_date: localDate,
      skipped: true,
    };
  }

  async checkTodayRoutine(userId: string, routineId: string, requestedDate?: string) {
    const user = await this.findUserOrThrow(userId);
    const localDate = resolveRequestedLocalDate(requestedDate, user.timezone);
    const routine = await this.prisma.routine.findFirst({
      where: { id: routineId, userId },
    });

    if (!routine) {
      throw new NotFoundException('Routine was not found.');
    }

    if (this.timesPerWeekOf(routine) === null) {
      throw new BadRequestException(
        'check-today is only available for times-per-week routines.',
      );
    }

    const existingTask = await this.findRoutineTaskForDate(
      userId,
      routine.name,
      localDate,
    );
    let task = existingTask;

    if (!task) {
      task = await this.createRoutineTask(userId, routine, localDate, user.timezone, {
        status: TaskStatus.DONE,
        completedAt: localDate === resolveRequestedLocalDate(undefined, user.timezone)
          ? new Date() : buildUtcDayRangeForTimezone(localDate, user.timezone).start,
      });
    } else if (task.status !== TaskStatus.DONE) {
      task = await this.prisma.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.DONE, completedAt: localDate === resolveRequestedLocalDate(undefined, user.timezone)
          ? new Date() : buildUtcDayRangeForTimezone(localDate, user.timezone).start },
      });
    }

    return {
      routine_id: routineId,
      task_id: task.id,
      local_date: localDate,
    };
  }

  private async ensureTodayTasks(
    userId: string,
    localDate: string,
    timezone: string,
  ) {
    const todayDow = parseLocalDate(localDate).getUTCDay(); // 0(Sun) ~ 6(Sat)

    // 활성화된 사용자 루틴을 모두 가져옵니다
    const routines = await this.prisma.routine.findMany({
      where: {
        userId,
        isActive: true,
      },
    });

    let generatedCount = 0;

    for (const routine of routines) {
      const rule = routine.cadencePayloadJson as { daysOfWeek?: number[] };
      
      // 오늘 요일에 실행하는 루틴인지 확인
      if (!rule || !Array.isArray(rule.daysOfWeek) || !rule.daysOfWeek.includes(todayDow)) {
        continue;
      }

      // 오늘 이미 이 루틴으로 Task가 생성되었는지 확인 (중복 생성 방지)
      const existingTask = await this.findRoutineTaskForDate(
        userId,
        routine.name,
        localDate,
      );

      if (!existingTask) {
        await this.createRoutineTask(userId, routine, localDate, timezone);
        generatedCount++;
      }
    }

    return { generatedCount };
  }

  private async buildRoutineResponses(
    userId: string,
    timezone: string,
    localDate: string,
    routines: Routine[],
  ) {
    const names = [...new Set(routines.map((routine) => routine.name))];
    const tasks = names.length === 0
      ? []
      : await this.prisma.task.findMany({
          where: {
            userId,
            sourceType: TaskSourceType.ROUTINE,
            title: { in: names },
          },
          orderBy: [{ localDueDate: 'desc' }, { completedAt: 'desc' }],
        });

    return routines.map((routine) =>
      this.toRoutineResponse(routine, tasks, localDate, timezone),
    );
  }

  private toRoutineResponse(
    routine: Routine,
    tasks: RoutineTaskSource[],
    localDate: string,
    timezone: string,
  ) {
    const routineTasks = tasks.filter((task) => task.title === routine.name);
    const todayTask = routineTasks.find(
      (task) => this.taskLocalDate(task, timezone) === localDate,
    );
    const lastCompletedTask = routineTasks.find(
      (task) => task.status === TaskStatus.DONE && task.completedAt,
    );
    const lastCompletedLocalDate = lastCompletedTask
      ? this.formatDateInTimezone(
          lastCompletedTask.completedAt ?? lastCompletedTask.dueAt ?? lastCompletedTask.createdAt,
          timezone,
        )
      : null;
    const timesPerWeek = this.timesPerWeekOf(routine);
    const weekly =
      timesPerWeek === null
        ? null
        : this.summarizeWeeks(routine, routineTasks, localDate, timezone, timesPerWeek);

    return {
      id: routine.id,
      name: routine.name,
      note: routine.note,
      cadenceType: routine.cadenceType,
      cadencePayloadJson: routine.cadencePayloadJson,
      recommendation_window:
        (routine.cadencePayloadJson as RoutineCadenceRule | null)?.recommendationWindow ?? null,
      isActive: routine.isActive,
      createdAt: routine.createdAt.toISOString(),
      updatedAt: routine.updatedAt.toISOString(),
      last_completed_at: lastCompletedTask?.completedAt?.toISOString() ?? null,
      last_completed_local_date: lastCompletedLocalDate,
      streak_count:
        weekly?.streak ??
        this.calculateStreak(routine, routineTasks, localDate, timezone),
      times_per_week: timesPerWeek,
      week_done_count: weekly?.doneCount ?? null,
      week_achieved: weekly?.achieved ?? null,
      today_task_id: todayTask?.id ?? null,
      today_task_status: todayTask?.status ?? null,
      is_due_today: this.isRoutineDueOn(routine, localDate),
      is_today_generated: Boolean(todayTask),
      is_today_skipped: todayTask?.status === TaskStatus.ARCHIVED,
    };
  }

  private timesPerWeekOf(routine: Routine): number | null {
    const rule = routine.cadencePayloadJson as RoutineCadenceRule | null;
    const value = rule?.timesPerWeek;

    return typeof value === 'number' && value > 0 ? value : null;
  }

  // 이번 주(월~일) 수행 일수와, 진행 중인 이번 주를 제외하면 끊기지 않는 연속 달성 주 수.
  private summarizeWeeks(
    routine: Routine,
    tasks: RoutineTaskSource[],
    localDate: string,
    timezone: string,
    timesPerWeek: number,
  ): WeeklyProgress {
    const doneDates = new Set<string>();

    for (const task of tasks) {
      const taskDate = task.status === TaskStatus.DONE
        ? this.taskLocalDate(task, timezone)
        : null;

      if (taskDate) {
        doneDates.add(taskDate);
      }
    }

    const countWeek = (weekStart: string) => {
      let count = 0;

      for (let offset = 0; offset < 7; offset++) {
        if (doneDates.has(this.shiftLocalDate(weekStart, offset))) {
          count++;
        }
      }

      return count;
    };

    const firstWeek = this.startOfWeek(
      this.formatDateInTimezone(routine.createdAt, timezone),
    );
    const thisWeek = this.startOfWeek(localDate);
    const doneCount = countWeek(thisWeek);
    const achieved = doneCount >= timesPerWeek;
    let streak = achieved ? 1 : 0;

    for (
      let weekStart = this.shiftLocalDate(thisWeek, -7);
      weekStart >= firstWeek && countWeek(weekStart) >= timesPerWeek;
      weekStart = this.shiftLocalDate(weekStart, -7)
    ) {
      streak++;
    }

    return { doneCount, achieved, streak };
  }

  private startOfWeek(localDate: string): string {
    const mondayOffset = (parseLocalDate(localDate).getUTCDay() + 6) % 7;

    return this.shiftLocalDate(localDate, -mondayOffset);
  }

  private shiftLocalDate(localDate: string, days: number): string {
    const date = parseLocalDate(localDate);
    date.setUTCDate(date.getUTCDate() + days);
    return formatLocalDate(date);
  }

  private calculateStreak(
    routine: Routine,
    tasks: RoutineTaskSource[],
    localDate: string,
    timezone: string,
  ): number {
    const tasksByDate = new Map<string, RoutineTaskSource[]>();

    for (const task of tasks) {
      const taskDate = this.taskLocalDate(task, timezone);

      if (!taskDate) {
        continue;
      }

      tasksByDate.set(taskDate, [...(tasksByDate.get(taskDate) ?? []), task]);
    }

    let cursor = localDate;
    let streak = 0;
    let skippedToday = false;

    while (cursor) {
      const dueDate = this.previousDueDateOnOrBefore(routine, cursor);

      if (!dueDate) {
        break;
      }

      const dayTasks = tasksByDate.get(dueDate) ?? [];
      const hasDone = dayTasks.some((task) => task.status === TaskStatus.DONE);

      if (hasDone) {
        streak++;
      } else if (dueDate === localDate && !skippedToday) {
        skippedToday = true;
      } else {
        break;
      }

      cursor = this.previousLocalDate(dueDate);
    }

    return streak;
  }

  private previousDueDateOnOrBefore(
    routine: Routine,
    localDate: string,
  ): string | null {
    let cursor = localDate;

    for (let attempt = 0; attempt < 370; attempt++) {
      if (this.isRoutineDueOn(routine, cursor)) {
        return cursor;
      }

      cursor = this.previousLocalDate(cursor);
    }

    return null;
  }

  private previousLocalDate(localDate: string): string {
    const date = parseLocalDate(localDate);
    date.setUTCDate(date.getUTCDate() - 1);
    return formatLocalDate(date);
  }

  private isRoutineDueOn(routine: Routine, localDate: string): boolean {
    if (!routine.isActive) {
      return false;
    }

    const rule = routine.cadencePayloadJson as { daysOfWeek?: number[] };
    const dow = parseLocalDate(localDate).getUTCDay();

    return Array.isArray(rule.daysOfWeek) && rule.daysOfWeek.includes(dow);
  }

  private async createRoutineTask(
    userId: string,
    routine: Routine,
    localDate: string,
    timezone: string,
    completion: Pick<Prisma.TaskUncheckedCreateInput, 'status' | 'completedAt'> = {},
  ) {
    const range = buildUtcDayRangeForTimezone(localDate, timezone);

    return this.prisma.task.create({
      data: {
        userId,
        title: routine.name,
        note: routine.note,
        sourceType: TaskSourceType.ROUTINE,
        dueAt: range.start,
        localDueDate: parseLocalDate(localDate),
        ...completion,
      },
    });
  }

  private async findRoutineTaskForDate(
    userId: string,
    title: string,
    localDate: string,
  ) {
    return this.prisma.task.findFirst({
      where: {
        userId,
        title,
        sourceType: TaskSourceType.ROUTINE,
        localDueDate: parseLocalDate(localDate),
      },
    });
  }

  private taskLocalDate(
    task: RoutineTaskSource,
    timezone: string,
  ): string | null {
    if (task.localDueDate) {
      return formatLocalDate(task.localDueDate);
    }

    const sourceDate = task.completedAt ?? task.dueAt ?? task.createdAt;

    return this.formatDateInTimezone(sourceDate, timezone);
  }

  private formatDateInTimezone(date: Date, timezone: string): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;

    if (!year || !month || !day) {
      return formatLocalDate(date);
    }

    return `${year}-${month}-${day}`;
  }

  private async findUserOrThrow(
    userId: string,
  ): Promise<Pick<User, 'id' | 'timezone'>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, timezone: true },
    });

    if (!user) {
      throw new NotFoundException('User was not found.');
    }

    return user;
  }
}
