import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IdeaStatus, TaskStatus } from '@prisma/client';

import { IdeasService } from './ideas.service';

const DEMO_IDEA = {
  id: 'idea-1',
  userId: 'user-1',
  title: '발표 아이디어 정리',
  note: null,
  status: IdeaStatus.ACTIVE,
  tagsJson: ['work'],
  convertedTaskId: null,
  createdAt: new Date('2026-04-01'),
  updatedAt: new Date('2026-04-01'),
  archivedAt: null,
};

const CONVERTED_IDEA = {
  ...DEMO_IDEA,
  id: 'idea-converted',
  status: IdeaStatus.CONVERTED,
  convertedTaskId: 'task-1',
};

function createMockPrisma(overrides: Record<string, any> = {}) {
  return {
    idea: {
      create: jest.fn().mockImplementation(({ data }) => ({
        ...DEMO_IDEA,
        ...data,
        id: 'new-idea',
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      findMany: jest.fn().mockResolvedValue([DEMO_IDEA]),
      findFirst: jest.fn().mockResolvedValue(DEMO_IDEA),
      update: jest.fn().mockImplementation(({ data }) => ({
        ...DEMO_IDEA,
        ...data,
        updatedAt: new Date(),
      })),
    },
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', timezone: 'Asia/Seoul' }),
    },
    task: {
      create: jest.fn().mockResolvedValue({
        id: 'task-new',
        title: DEMO_IDEA.title,
        status: TaskStatus.INBOX,
      }),
    },
    todayFocus: {
      findFirst: jest.fn().mockResolvedValue({ id: 'focus-1' }),
    },
    $transaction: jest.fn().mockImplementation((fn) =>
      fn({
        task: {
          create: jest.fn().mockResolvedValue({
            id: 'task-new',
            title: DEMO_IDEA.title,
            note: null,
            status: TaskStatus.INBOX,
          }),
        },
        idea: {
          update: jest.fn().mockResolvedValue({
            ...DEMO_IDEA,
            status: IdeaStatus.CONVERTED,
            convertedTaskId: 'task-new',
          }),
        },
      }),
    ),
    ...overrides,
  } as any;
}

describe('IdeasService', () => {
  describe('createIdea', () => {
    it('should create an idea with ACTIVE status', async () => {
      const prisma = createMockPrisma();
      const service = new IdeasService(prisma);

      const result = await service.createIdea('user-1', {
        title: '새 아이디어',
      });

      expect(result.title).toBe('새 아이디어');
      expect(result.status).toBe(IdeaStatus.ACTIVE);
      expect(prisma.idea.create).toHaveBeenCalled();
    });

    it('should store tags as JSON', async () => {
      const prisma = createMockPrisma();
      const service = new IdeasService(prisma);

      await service.createIdea('user-1', {
        title: 'tagged idea',
        tags: ['work', 'important'],
      });

      expect(prisma.idea.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tagsJson: ['work', 'important'],
          }),
        }),
      );
    });
  });

  describe('getIdea', () => {
    it('should return the idea', async () => {
      const service = new IdeasService(createMockPrisma());
      const result = await service.getIdea('user-1', 'idea-1');
      expect(result.id).toBe('idea-1');
    });

    it('should throw when not found', async () => {
      const prisma = createMockPrisma();
      prisma.idea.findFirst = jest.fn().mockResolvedValue(null);
      const service = new IdeasService(prisma);

      await expect(
        service.getIdea('user-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateIdea', () => {
    it('should prevent updates to CONVERTED ideas', async () => {
      const prisma = createMockPrisma();
      prisma.idea.findFirst = jest.fn().mockResolvedValue(CONVERTED_IDEA);
      const service = new IdeasService(prisma);

      await expect(
        service.updateIdea('user-1', 'idea-converted', { title: 'nope' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update title', async () => {
      const prisma = createMockPrisma();
      const service = new IdeasService(prisma);

      const result = await service.updateIdea('user-1', 'idea-1', {
        title: '수정된 제목',
      });

      expect(prisma.idea.update).toHaveBeenCalled();
    });
  });

  describe('listIdeas', () => {
    it('should exclude ARCHIVED by default and return paginated response', async () => {
      const prisma = createMockPrisma();
      const service = new IdeasService(prisma);

      const result = await service.listIdeas('user-1', {});

      expect(prisma.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { not: IdeaStatus.ARCHIVED },
          }),
        }),
      );
      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('meta');
      expect(result.meta).toHaveProperty('next_cursor');
    });
  });

  describe('convertToTask', () => {
    it('should convert idea to task in a transaction', async () => {
      const prisma = createMockPrisma();
      const service = new IdeasService(prisma);

      const result = await service.convertToTask('user-1', 'idea-1', {});

      expect(result.idea_id).toBe('idea-1');
      expect(result.task.id).toBe('task-new');
      expect(result.task.status).toBe(TaskStatus.INBOX);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should throw when idea already converted', async () => {
      const prisma = createMockPrisma();
      prisma.idea.findFirst = jest.fn().mockResolvedValue(CONVERTED_IDEA);
      const service = new IdeasService(prisma);

      await expect(
        service.convertToTask('user-1', 'idea-converted', {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when idea not found', async () => {
      const prisma = createMockPrisma();
      prisma.idea.findFirst = jest.fn().mockResolvedValue(null);
      const service = new IdeasService(prisma);

      await expect(
        service.convertToTask('user-1', 'nonexistent', {}),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
