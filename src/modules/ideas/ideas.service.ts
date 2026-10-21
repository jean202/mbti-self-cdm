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

import { isUUID } from 'class-validator';

import { parseLocalDate } from '../../common/utils/local-date.util';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ConvertIdeaToTaskDto } from './dto/convert-idea-to-task.dto';
import { CreateIdeaDto } from './dto/create-idea.dto';
import { ListIdeasQueryDto } from './dto/list-ideas-query.dto';
import { UpdateIdeaDto } from './dto/update-idea.dto';
import { parseReviewDate } from './idea-review-date';

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
  | 'reviewOn'
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

    const reviewBefore = query.review_before === undefined
      ? undefined
      : parseReviewDate(query.review_before);
    const cursor = query.cursor ? await this.decodeCursor(userId, query.cursor) : null;
    if (reviewBefore && query.status && query.status !== IdeaStatus.ACTIVE) {
      return { items: [], meta: { next_cursor: null } };
    }
    where.status = query.status ?? (reviewBefore ? IdeaStatus.ACTIVE : { not: IdeaStatus.ARCHIVED });
    if (reviewBefore) where.reviewOn = { lte: reviewBefore };
    if (query.q) {
      // Escape SQL LIKE wildcards so user-entered search text is literal.
      const text = query.q.replace(/[\\%_]/g, '\\$&');
      where.OR = [
        { title: { contains: text, mode: 'insensitive' } },
        { note: { contains: text, mode: 'insensitive' } },
      ];
    }
    if (cursor) {
      where.AND = [{
        OR: [
          { updatedAt: { lt: cursor.updatedAt } },
          { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
        ],
      }];
    }
    const take = (query.limit ?? 50) + 1;

    const ideas = await this.prismaService.idea.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take,
    });

    const limit = query.limit ?? 50;
    const hasMore = ideas.length > limit;
    const items = hasMore ? ideas.slice(0, limit) : ideas;

    return {
      items: items.map((idea) => this.toIdeaResponse(idea)),
      meta: {
        next_cursor: hasMore ? this.encodeCursor(userId, items[items.length - 1]) : null,
      },
    };
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

    if (input.status === IdeaStatus.CONVERTED) {
      throw new BadRequestException('Use convert-to-task to convert an idea.');
    }
    const reviewOn = input.review_on === undefined
      ? undefined
      : input.review_on === null ? null : parseReviewDate(input.review_on);
    const nextStatus = input.status ?? existingIdea.status;

    let idea: Idea;
    try {
      idea = await this.prismaService.idea.update({
        // A concurrent conversion/archive must not be undone by a stale PATCH.
        where: { id: ideaId, userId, status: existingIdea.status },
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
          reviewOn: nextStatus === IdeaStatus.ARCHIVED ? null : reviewOn,
        },
      });
    } catch (error) {
      this.rethrowMutationConflict(error);
    }
    return this.toIdeaResponse(idea);
  }

  async deleteIdea(userId: string, ideaId: string) {
    // Task.linkedIdea uses ON DELETE SET NULL; never delete the linked task.
    const result = await this.prismaService.idea.deleteMany({ where: { id: ideaId, userId } });
    if (result.count === 0) throw new NotFoundException('Idea was not found.');
    return { id: ideaId };
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
          where: { id: ideaId, userId, status: idea.status, updatedAt: idea.updatedAt },
          data: {
            status: IdeaStatus.CONVERTED,
            convertedTaskId: createdTask.id,
            reviewOn: null,
            archivedAt: null,
          },
        });

        return [converted, createdTask] as const;
      },
    ).catch((error: unknown) => this.rethrowMutationConflict(error));

    return {
      idea_id: updatedIdea.id,
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
      },
    };
  }

  private rethrowMutationConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new BadRequestException('Idea changed or was deleted. Reload before retrying.');
    }
    throw error;
  }

  private encodeCursor(userId: string, idea: IdeaResponseSource): string {
    return Buffer.from(JSON.stringify({
      v: 1, userId, updatedAt: idea.updatedAt.toISOString(), id: idea.id,
    })).toString('base64url');
  }

  private async decodeCursor(userId: string, cursor: string): Promise<{ updatedAt: Date; id: string }> {
    if (isUUID(cursor)) {
      const idea = await this.prismaService.idea.findFirst({ where: { id: cursor, userId } });
      if (!idea) throw new NotFoundException('Idea cursor was not found.');
      return { id: idea.id, updatedAt: idea.updatedAt };
    }
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(cursor) || cursor.length > 2048) throw new Error('Invalid encoding');
      const data = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (data.v !== 1 || data.userId !== userId ||
          typeof data.id !== 'string' || !isUUID(data.id) ||
          typeof data.updatedAt !== 'string') {
        throw new Error('Invalid cursor');
      }
      const updatedAt = new Date(data.updatedAt);
      if (Number.isNaN(updatedAt.getTime()) || updatedAt.toISOString() !== data.updatedAt) throw new Error('Invalid timestamp');
      return { updatedAt, id: data.id };
    } catch {
      throw new BadRequestException('Invalid idea cursor.');
    }
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
      review_on: idea.reviewOn?.toISOString().slice(0, 10) ?? null,
    };
  }
}
