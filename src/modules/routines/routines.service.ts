import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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

@Injectable()
export class RoutinesService {
  private readonly logger = new Logger(RoutinesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createRoutine(userId: string, dto: CreateRoutineDto) {
    this.logger.log(`Creating routine for user: ${userId}`);
    return this.prisma.routine.create({
      data: {
        userId,
        name: dto.title,
        note: dto.note,
        cadenceType: RoutineCadenceType.WEEKLY,
        isActive: dto.isActive ?? true,
        cadencePayloadJson: { daysOfWeek: dto.daysOfWeek } as Prisma.InputJsonValue,
      },
    });
  }

  async getRoutines(userId: string) {
    const user = await this.findUserOrThrow(userId);
    const localDate = resolveRequestedLocalDate(undefined, user.timezone);

    await this.ensureTodayTasks(userId, localDate, user.timezone);

    const routines = await this.prisma.routine.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return this.buildRoutineResponses(userId, user.timezone, localDate, routines);
  }

  async generateTodayTasks(userId: string) {
    this.logger.log(`Checking routines to generate today's tasks for user: ${userId}`);
    const user = await this.findUserOrThrow(userId);
    const localDate = resolveRequestedLocalDate(undefined, user.timezone);

    const result = await this.ensureTodayTasks(userId, localDate, user.timezone);

    return { generated_count: result.generatedCount };
  }

  async skipTodayRoutine(userId: string, routineId: string) {
    const user = await this.findUserOrThrow(userId);
    const localDate = resolveRequestedLocalDate(undefined, user.timezone);
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

    return {
      id: routine.id,
      name: routine.name,
      note: routine.note,
      cadenceType: routine.cadenceType,
      cadencePayloadJson: routine.cadencePayloadJson,
      isActive: routine.isActive,
      createdAt: routine.createdAt.toISOString(),
      updatedAt: routine.updatedAt.toISOString(),
      last_completed_at: lastCompletedTask?.completedAt?.toISOString() ?? null,
      last_completed_local_date: lastCompletedLocalDate,
      streak_count: this.calculateStreak(
        routine,
        routineTasks,
        localDate,
        timezone,
      ),
      today_task_id: todayTask?.id ?? null,
      today_task_status: todayTask?.status ?? null,
      is_due_today: this.isRoutineDueOn(routine, localDate),
      is_today_generated: Boolean(todayTask),
      is_today_skipped: todayTask?.status === TaskStatus.ARCHIVED,
    };
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
