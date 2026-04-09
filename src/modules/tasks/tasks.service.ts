import { Injectable, NotFoundException } from '@nestjs/common';
import { TaskStatus, type Prisma, type Task, type User } from '@prisma/client';

import { formatLocalDate, parseLocalDate } from '../../common/utils/local-date.util';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { RescheduleTaskDto } from './dto/reschedule-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

type TaskResponseSource = Pick<
  Task,
  | 'id'
  | 'title'
  | 'note'
  | 'status'
  | 'sourceType'
  | 'todayFocusId'
  | 'dueAt'
  | 'localDueDate'
  | 'reminderAt'
  | 'energyEstimate'
  | 'sortOrder'
  | 'completedAt'
  | 'createdAt'
  | 'updatedAt'
>;

@Injectable()
export class TasksService {
  constructor(private readonly prismaService: PrismaService) {}

  async createTask(userId: string, input: CreateTaskDto) {
    const user = await this.findUserOrThrow(userId);

    if (input.today_focus_id) {
      await this.ensureTodayFocusBelongsToUser(userId, input.today_focus_id);
    }

    const dueAt = input.due_at ? new Date(input.due_at) : null;
    const reminderAt = input.reminder_at ? new Date(input.reminder_at) : null;
    const localDueDate = dueAt
      ? this.toLocalDateValue(dueAt, user.timezone)
      : null;

    const task = await this.prismaService.task.create({
      data: {
        userId,
        title: input.title,
        note: input.note ?? null,
        status: TaskStatus.INBOX,
        sourceType: input.source_type,
        todayFocusId: input.today_focus_id ?? null,
        dueAt,
        localDueDate,
        reminderAt,
        energyEstimate: input.energy_estimate ?? null,
        sortOrder: input.sort_order ?? null,
      },
    });

    return this.toTaskResponse(task);
  }

  async listTasks(userId: string, query: ListTasksQueryDto) {
    const where: Prisma.TaskWhereInput = {
      userId,
    };

    if (query.status) {
      where.status = query.status;
    } else {
      where.status = {
        not: TaskStatus.ARCHIVED,
      };
    }

    if (query.today_focus_id) {
      where.todayFocusId = query.today_focus_id;
    }

    if (query.local_date) {
      where.localDueDate = parseLocalDate(query.local_date);
    }

    const tasks = await this.prismaService.task.findMany({
      where,
      orderBy: [
        { sortOrder: 'asc' },
        { dueAt: 'asc' },
        { updatedAt: 'desc' },
      ],
      take: query.limit ?? 50,
    });

    return tasks.map((task) => this.toTaskResponse(task));
  }

  async getTask(userId: string, taskId: string) {
    const task = await this.prismaService.task.findFirst({
      where: {
        id: taskId,
        userId,
      },
    });

    if (!task) {
      throw new NotFoundException('Task was not found.');
    }

    return this.toTaskResponse(task);
  }

  async updateTask(userId: string, taskId: string, input: UpdateTaskDto) {
    const [user, existingTask] = await Promise.all([
      this.findUserOrThrow(userId),
      this.prismaService.task.findFirst({
        where: {
          id: taskId,
          userId,
        },
      }),
    ]);

    if (!existingTask) {
      throw new NotFoundException('Task was not found.');
    }

    if (input.today_focus_id) {
      await this.ensureTodayFocusBelongsToUser(userId, input.today_focus_id);
    }

    const dueAt = this.resolveDateField(input.due_at);
    const nextStatus = input.status ?? existingTask.status;
    const task = await this.prismaService.task.update({
      where: {
        id: taskId,
      },
      data: {
        title: input.title ?? undefined,
        note: input.note === undefined ? undefined : input.note,
        status: input.status ?? undefined,
        todayFocusId:
          input.today_focus_id === undefined ? undefined : input.today_focus_id,
        dueAt: dueAt === undefined ? undefined : dueAt,
        localDueDate:
          dueAt === undefined
            ? undefined
            : dueAt
              ? this.toLocalDateValue(dueAt, user.timezone)
              : null,
        reminderAt: this.resolveDateField(input.reminder_at),
        energyEstimate:
          input.energy_estimate === undefined ? undefined : input.energy_estimate,
        sortOrder: input.sort_order === undefined ? undefined : input.sort_order,
        completedAt: this.resolveCompletedAt(existingTask.completedAt, nextStatus),
      },
    });

    return this.toTaskResponse(task);
  }

  async completeTask(userId: string, taskId: string) {
    const task = await this.prismaService.task.findFirst({
      where: { id: taskId, userId },
    });

    if (!task) {
      throw new NotFoundException('Task was not found.');
    }

    const updated = await this.prismaService.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.DONE,
        completedAt: task.completedAt ?? new Date(),
      },
    });

    return this.toTaskResponse(updated);
  }

  async rescheduleTask(userId: string, taskId: string, input: RescheduleTaskDto) {
    const [user, task] = await Promise.all([
      this.findUserOrThrow(userId),
      this.prismaService.task.findFirst({
        where: { id: taskId, userId },
      }),
    ]);

    if (!task) {
      throw new NotFoundException('Task was not found.');
    }

    const dueAt = input.due_at === undefined
      ? undefined
      : input.due_at
        ? new Date(input.due_at)
        : null;

    const localDueDate = input.local_due_date === undefined
      ? dueAt === undefined
        ? undefined
        : dueAt
          ? this.toLocalDateValue(dueAt, user.timezone)
          : null
      : input.local_due_date
        ? parseLocalDate(input.local_due_date)
        : null;

    const updated = await this.prismaService.task.update({
      where: { id: taskId },
      data: {
        ...(dueAt !== undefined && { dueAt }),
        ...(localDueDate !== undefined && { localDueDate }),
      },
    });

    return this.toTaskResponse(updated);
  }

  private async findUserOrThrow(
    userId: string,
  ): Promise<Pick<User, 'id' | 'timezone'>> {
    const user = await this.prismaService.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        timezone: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User was not found.');
    }

    return user;
  }

  private async ensureTodayFocusBelongsToUser(
    userId: string,
    todayFocusId: string,
  ): Promise<void> {
    const todayFocus = await this.prismaService.todayFocus.findFirst({
      where: {
        id: todayFocusId,
        userId,
      },
      select: {
        id: true,
      },
    });

    if (!todayFocus) {
      throw new NotFoundException('Today focus was not found.');
    }
  }

  private resolveDateField(value: string | null | undefined): Date | null | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    return new Date(value);
  }

  private resolveCompletedAt(
    currentCompletedAt: Date | null,
    status: TaskStatus,
  ): Date | null {
    if (status === TaskStatus.DONE) {
      return currentCompletedAt ?? new Date();
    }

    return null;
  }

  private toLocalDateValue(date: Date, timezone: string): Date {
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
      throw new NotFoundException('Failed to resolve task local due date.');
    }

    return parseLocalDate(`${year}-${month}-${day}`);
  }

  private toTaskResponse(task: TaskResponseSource) {
    return {
      id: task.id,
      title: task.title,
      note: task.note,
      status: task.status,
      source_type: task.sourceType,
      today_focus_id: task.todayFocusId,
      due_at: task.dueAt?.toISOString() ?? null,
      local_due_date: task.localDueDate
        ? formatLocalDate(task.localDueDate)
        : null,
      reminder_at: task.reminderAt?.toISOString() ?? null,
      energy_estimate: task.energyEstimate,
      sort_order: task.sortOrder,
      completed_at: task.completedAt?.toISOString() ?? null,
      created_at: task.createdAt.toISOString(),
      updated_at: task.updatedAt.toISOString(),
    };
  }
}
