import { NotFoundException } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';

import { TasksService } from './tasks.service';

const DEMO_USER = { id: 'user-1', timezone: 'Asia/Seoul' };

const DEMO_TASK = {
  id: 'task-1',
  userId: 'user-1',
  title: '보고서 작성',
  note: null,
  status: TaskStatus.INBOX,
  sourceType: 'MANUAL',
  todayFocusId: null,
  dueAt: null,
  localDueDate: null,
  reminderAt: null,
  energyEstimate: null,
  sortOrder: null,
  completedAt: null,
  createdAt: new Date('2026-04-01'),
  updatedAt: new Date('2026-04-01'),
};

function createMockPrisma(overrides: Record<string, any> = {}) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(DEMO_USER),
    },
    task: {
      create: jest.fn().mockImplementation(({ data }) => ({
        ...DEMO_TASK,
        ...data,
        id: 'new-task-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      findMany: jest.fn().mockResolvedValue([DEMO_TASK]),
      findFirst: jest.fn().mockResolvedValue(DEMO_TASK),
      update: jest.fn().mockImplementation(({ data }) => ({
        ...DEMO_TASK,
        ...data,
        updatedAt: new Date(),
      })),
    },
    todayFocus: {
      findFirst: jest.fn().mockResolvedValue({ id: 'focus-1' }),
    },
    ...overrides,
  } as any;
}

describe('TasksService', () => {
  describe('createTask', () => {
    it('should create a task with INBOX status', async () => {
      const prisma = createMockPrisma();
      const service = new TasksService(prisma);

      const result = await service.createTask('user-1', {
        title: '새 태스크',
        source_type: 'MANUAL',
      });

      expect(result.title).toBe('새 태스크');
      expect(result.status).toBe(TaskStatus.INBOX);
      expect(prisma.task.create).toHaveBeenCalled();
    });

    it('should throw when user not found', async () => {
      const prisma = createMockPrisma({
        user: { findUnique: jest.fn().mockResolvedValue(null) },
      });
      const service = new TasksService(prisma);

      await expect(
        service.createTask('nonexistent', {
          title: 'test',
          source_type: 'MANUAL',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getTask', () => {
    it('should return the task when found', async () => {
      const prisma = createMockPrisma();
      const service = new TasksService(prisma);

      const result = await service.getTask('user-1', 'task-1');

      expect(result.id).toBe('task-1');
      expect(result.title).toBe('보고서 작성');
    });

    it('should throw NotFoundException when task not found', async () => {
      const prisma = createMockPrisma({
        task: {
          ...createMockPrisma().task,
          findFirst: jest.fn().mockResolvedValue(null),
        },
      });
      const service = new TasksService(prisma);

      await expect(
        service.getTask('user-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('completeTask', () => {
    it('should mark task as DONE with completedAt', async () => {
      const prisma = createMockPrisma();
      const service = new TasksService(prisma);

      await service.completeTask('user-1', 'task-1');

      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: TaskStatus.DONE,
          }),
        }),
      );
    });

    it('should throw when task not found', async () => {
      const prisma = createMockPrisma({
        task: {
          ...createMockPrisma().task,
          findFirst: jest.fn().mockResolvedValue(null),
        },
      });
      const service = new TasksService(prisma);

      await expect(
        service.completeTask('user-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('rescheduleTask', () => {
    it('should update dueAt and localDueDate', async () => {
      const prisma = createMockPrisma();
      const service = new TasksService(prisma);

      await service.rescheduleTask('user-1', 'task-1', {
        due_at: '2026-04-15T09:00:00Z',
      });

      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1' },
        }),
      );
    });

    it('should accept explicit local_due_date', async () => {
      const prisma = createMockPrisma();
      const service = new TasksService(prisma);

      await service.rescheduleTask('user-1', 'task-1', {
        due_at: '2026-04-15T09:00:00Z',
        local_due_date: '2026-04-15',
      });

      expect(prisma.task.update).toHaveBeenCalled();
    });

    it('should throw when task not found', async () => {
      const prisma = createMockPrisma({
        task: {
          ...createMockPrisma().task,
          findFirst: jest.fn().mockResolvedValue(null),
        },
      });
      const service = new TasksService(prisma);

      await expect(
        service.rescheduleTask('user-1', 'nonexistent', {
          due_at: '2026-04-15T09:00:00Z',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listTasks', () => {
    it('should exclude ARCHIVED tasks by default and return paginated response', async () => {
      const prisma = createMockPrisma();
      const service = new TasksService(prisma);

      const result = await service.listTasks('user-1', {});

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { not: TaskStatus.ARCHIVED },
          }),
        }),
      );
      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('meta');
      expect(result.meta).toHaveProperty('next_cursor');
    });

    it('should filter by specific status', async () => {
      const prisma = createMockPrisma();
      const service = new TasksService(prisma);

      const result = await service.listTasks('user-1', { status: TaskStatus.DONE });

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: TaskStatus.DONE,
          }),
        }),
      );
      expect(result.items).toHaveLength(1);
    });
  });
});
