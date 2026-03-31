import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IdeaStatus,
  Prisma,
  TaskSourceType,
  TaskStatus,
  type Idea,
  type User,
} from '@prisma/client';

import { parseLocalDate } from '../../common/utils/local-date.util';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ConvertIdeaToTaskDto } from './dto/convert-idea-to-task.dto';
import { CreateIdeaDto } from './dto/create-idea.dto';
import { ListIdeasQueryDto } from './dto/list-ideas-query.dto';
import { UpdateIdeaDto } from './dto/update-idea.dto';

type IdeaResponseSource = Pick<
  Idea,
  | 'id'
  | 'title'
  | 'note'
  | 'status'
  | 'tagsJson'
  | 'convertedTaskId'
  | 'createdAt'
  | 'updatedAt'
  | 'archivedAt'
>;

@Injectable()
export class IdeasService {
  constructor(private readonly prismaService: PrismaService) {}

  async createIdea(userId: string, input: CreateIdeaDto) {
    const idea = await this.prismaService.idea.create({
      data: {
        userId,
        title: input.title,
        note: input.note ?? null,
        status: IdeaStatus.ACTIVE,
        tagsJson: input.tags ?? Prisma.JsonNull,
      },
    });

    return this.toIdeaResponse(idea);
  }

  async listIdeas(userId: string, query: ListIdeasQueryDto) {
    const where: Prisma.IdeaWhereInput = { userId };

    if (query.status) {
      where.status = query.status;
    } else {
      where.status = { not: IdeaStatus.ARCHIVED };
    }

    const ideas = await this.prismaService.idea.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      take: query.limit ?? 50,
    });

    return ideas.map((idea) => this.toIdeaResponse(idea));
  }

  async getIdea(userId: string, ideaId: string) {
    const idea = await this.prismaService.idea.findFirst({
      where: { id: ideaId, userId },
    });

    if (!idea) {
      throw new NotFoundException('Idea was not found.');
    }

    return this.toIdeaResponse(idea);
  }

  async updateIdea(userId: string, ideaId: string, input: UpdateIdeaDto) {
    const existingIdea = await this.prismaService.idea.findFirst({
      where: { id: ideaId, userId },
    });

    if (!existingIdea) {
      throw new NotFoundException('Idea was not found.');
    }

    if (existingIdea.status === IdeaStatus.CONVERTED) {
      throw new BadRequestException(
        'Cannot update an idea that has already been converted to a task.',
      );
    }

    const nextStatus = input.status ?? existingIdea.status;

    const idea = await this.prismaService.idea.update({
      where: { id: ideaId },
      data: {
        title: input.title ?? undefined,
        note: input.note === undefined ? undefined : input.note,
        status: input.status ?? undefined,
        tagsJson:
          input.tags === undefined
            ? undefined
            : input.tags === null
              ? Prisma.JsonNull
              : input.tags,
        archivedAt: this.resolveArchivedAt(existingIdea.archivedAt, nextStatus),
      },
    });

    return this.toIdeaResponse(idea);
  }

  async convertToTask(
    userId: string,
    ideaId: string,
    input: ConvertIdeaToTaskDto,
  ) {
    const [user, idea] = await Promise.all([
      this.findUserOrThrow(userId),
      this.prismaService.idea.findFirst({
        where: { id: ideaId, userId },
      }),
    ]);

    if (!idea) {
      throw new NotFoundException('Idea was not found.');
    }

    if (idea.status === IdeaStatus.CONVERTED) {
      throw new BadRequestException('Idea has already been converted to a task.');
    }

    if (input.today_focus_id) {
      await this.ensureTodayFocusBelongsToUser(userId, input.today_focus_id);
    }

    const dueAt = input.due_at ? new Date(input.due_at) : null;
    const localDueDate = dueAt
      ? this.toLocalDateValue(dueAt, user.timezone)
      : null;

    const [updatedIdea, task] = await this.prismaService.$transaction(
      async (tx) => {
        const createdTask = await tx.task.create({
          data: {
            userId,
            title: idea.title,
            note: idea.note,
            status: TaskStatus.INBOX,
            sourceType: TaskSourceType.IDEA_CONVERSION,
            linkedIdeaId: ideaId,
            todayFocusId: input.today_focus_id ?? null,
            dueAt,
            localDueDate,
          },
        });

        const converted = await tx.idea.update({
          where: { id: ideaId },
          data: {
            status: IdeaStatus.CONVERTED,
            convertedTaskId: createdTask.id,
          },
        });

        return [converted, createdTask] as const;
      },
    );

    return {
      idea_id: updatedIdea.id,
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
      },
    };
  }

  private async findUserOrThrow(
    userId: string,
  ): Promise<Pick<User, 'id' | 'timezone'>> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { id: true, timezone: true },
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
      where: { id: todayFocusId, userId },
      select: { id: true },
    });

    if (!todayFocus) {
      throw new NotFoundException('Today focus was not found.');
    }
  }

  private resolveArchivedAt(
    currentArchivedAt: Date | null,
    status: IdeaStatus,
  ): Date | null {
    if (status === IdeaStatus.ARCHIVED) {
      return currentArchivedAt ?? new Date();
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
      throw new BadRequestException('Failed to resolve local due date.');
    }

    return parseLocalDate(`${year}-${month}-${day}`);
  }

  private toIdeaResponse(idea: IdeaResponseSource) {
    return {
      id: idea.id,
      title: idea.title,
      note: idea.note,
      status: idea.status,
      tags: idea.tagsJson as string[] | null,
      converted_task_id: idea.convertedTaskId,
      created_at: idea.createdAt.toISOString(),
      updated_at: idea.updatedAt.toISOString(),
      archived_at: idea.archivedAt?.toISOString() ?? null,
    };
  }
}
