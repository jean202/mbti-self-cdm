import {
  RoutineCadenceType,
  TaskSourceType,
  TaskStatus,
} from '@prisma/client';

import { RoutinesService } from './routines.service';

const FRIDAY_ROUTINE = {
  id: 'routine-1',
  userId: 'user-1',
  name: '이불 개기',
  note: '침대 정리',
  cadenceType: RoutineCadenceType.WEEKLY,
  cadencePayloadJson: { daysOfWeek: [5] },
  isActive: true,
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
  updatedAt: new Date('2026-05-01T00:00:00.000Z'),
};

function createMockPrisma(overrides: Record<string, any> = {}) {
  return {
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', timezone: 'Asia/Seoul' }),
    },
    routine: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([FRIDAY_ROUTINE]),
      findFirst: jest.fn().mockResolvedValue(FRIDAY_ROUTINE),
    },
    task: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => ({
        ...data,
        id: 'task-new',
        status: TaskStatus.INBOX,
        createdAt: new Date('2026-05-29T00:00:00.000Z'),
      })),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as any;
}

describe('RoutinesService', () => {
  beforeEach(() => {
    jest
      .useFakeTimers()
      .setSystemTime(Date.parse('2026-05-29T00:30:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('generateTodayTasks', () => {
    it('creates due routine tasks with local due date and due time', async () => {
      const prisma = createMockPrisma();
      const service = new RoutinesService(prisma);

      const result = await service.generateTodayTasks('user-1');

      expect(result.generated_count).toBe(1);
      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: '이불 개기',
            sourceType: TaskSourceType.ROUTINE,
            localDueDate: new Date('2026-05-29T00:00:00.000Z'),
          }),
        }),
      );
    });

    it('does not duplicate an existing routine task for today', async () => {
      const prisma = createMockPrisma({
        task: {
          ...createMockPrisma().task,
          findFirst: jest.fn().mockResolvedValue({ id: 'task-existing' }),
        },
      });
      const service = new RoutinesService(prisma);

      const result = await service.generateTodayTasks('user-1');

      expect(result.generated_count).toBe(0);
      expect(prisma.task.create).not.toHaveBeenCalled();
    });
  });

  describe('getRoutines', () => {
    it('returns last completed date, today status, and streak count', async () => {
      const todayTask = {
        id: 'task-today',
        title: '이불 개기',
        status: TaskStatus.DONE,
        sourceType: TaskSourceType.ROUTINE,
        localDueDate: new Date('2026-05-29T00:00:00.000Z'),
        dueAt: new Date('2026-05-28T15:00:00.000Z'),
        completedAt: new Date('2026-05-29T00:05:00.000Z'),
        createdAt: new Date('2026-05-28T15:00:00.000Z'),
      };
      const previousTask = {
        ...todayTask,
        id: 'task-prev',
        localDueDate: new Date('2026-05-22T00:00:00.000Z'),
        completedAt: new Date('2026-05-22T00:05:00.000Z'),
      };
      const prisma = createMockPrisma({
        routine: {
          ...createMockPrisma().routine,
          findMany: jest
            .fn()
            .mockResolvedValueOnce([FRIDAY_ROUTINE])
            .mockResolvedValueOnce([FRIDAY_ROUTINE]),
        },
        task: {
          ...createMockPrisma().task,
          findFirst: jest.fn().mockResolvedValue(todayTask),
          findMany: jest.fn().mockResolvedValue([todayTask, previousTask]),
        },
      });
      const service = new RoutinesService(prisma);

      const result = await service.getRoutines('user-1');

      expect(result[0]).toEqual(
        expect.objectContaining({
          id: 'routine-1',
          today_task_id: 'task-today',
          today_task_status: TaskStatus.DONE,
          last_completed_local_date: '2026-05-29',
          streak_count: 2,
          is_due_today: true,
          is_today_generated: true,
        }),
      );
    });
  });
});
