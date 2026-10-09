import { BadRequestException, NotFoundException } from '@nestjs/common';
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

const TIMES_PER_WEEK_ROUTINE = {
  ...FRIDAY_ROUTINE,
  id: 'routine-2',
  name: '운동하기',
  note: null,
  cadenceType: RoutineCadenceType.CUSTOM,
  cadencePayloadJson: { timesPerWeek: 3 },
};

function routineTask(localDate: string, status: TaskStatus = TaskStatus.DONE) {
  return {
    id: `task-${localDate}`,
    title: '운동하기',
    status,
    sourceType: TaskSourceType.ROUTINE,
    localDueDate: new Date(`${localDate}T00:00:00.000Z`),
    dueAt: new Date(`${localDate}T00:00:00.000Z`),
    completedAt:
      status === TaskStatus.DONE ? new Date(`${localDate}T03:00:00.000Z`) : null,
    createdAt: new Date(`${localDate}T00:00:00.000Z`),
  };
}

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

function prismaWithTimesPerWeekTasks(tasks: ReturnType<typeof routineTask>[]) {
  return createMockPrisma({
    routine: {
      ...createMockPrisma().routine,
      findMany: jest.fn().mockResolvedValue([TIMES_PER_WEEK_ROUTINE]),
    },
    task: {
      ...createMockPrisma().task,
      findMany: jest.fn().mockResolvedValue(tasks),
    },
  });
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

  describe('createRoutine', () => {
    it('stores times-per-week routines as CUSTOM cadence', async () => {
      const prisma = createMockPrisma();
      const service = new RoutinesService(prisma);

      await service.createRoutine('user-1', { title: '운동하기', timesPerWeek: 3 });

      expect(prisma.routine.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: '운동하기',
          cadenceType: RoutineCadenceType.CUSTOM,
          cadencePayloadJson: { timesPerWeek: 3 },
        }),
      });
    });

    it('keeps weekday routines as WEEKLY cadence', async () => {
      const prisma = createMockPrisma();
      const service = new RoutinesService(prisma);

      await service.createRoutine('user-1', { title: '이불 개기', daysOfWeek: [1, 3] });

      expect(prisma.routine.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          cadenceType: RoutineCadenceType.WEEKLY,
          cadencePayloadJson: { daysOfWeek: [1, 3] },
        }),
      });
    });

    it.each([
      [{ title: '운동하기' }],
      [{ title: '운동하기', daysOfWeek: [] }],
      [{ title: '운동하기', daysOfWeek: [1], timesPerWeek: 3 }],
    ])('rejects unless exactly one cadence is given: %j', async (dto) => {
      const prisma = createMockPrisma();
      const service = new RoutinesService(prisma);

      await expect(service.createRoutine('user-1', dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.routine.create).not.toHaveBeenCalled();
    });
  });

  describe('checkTodayRoutine', () => {
    function prismaForCheck(existingTask: unknown, routine: unknown = TIMES_PER_WEEK_ROUTINE) {
      return createMockPrisma({
        routine: {
          ...createMockPrisma().routine,
          findFirst: jest.fn().mockResolvedValue(routine),
        },
        task: {
          ...createMockPrisma().task,
          findFirst: jest.fn().mockResolvedValue(existingTask),
          update: jest
            .fn()
            .mockResolvedValue({ id: 'task-existing', status: TaskStatus.DONE }),
        },
      });
    }

    it('records today as a done routine task', async () => {
      const prisma = prismaForCheck(null);
      const service = new RoutinesService(prisma);

      const result = await service.checkTodayRoutine('user-1', 'routine-2');

      expect(result).toEqual({
        routine_id: 'routine-2',
        task_id: 'task-new',
        local_date: '2026-05-29',
      });
      expect(prisma.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: '운동하기',
          sourceType: TaskSourceType.ROUTINE,
          status: TaskStatus.DONE,
          completedAt: new Date('2026-05-29T00:30:00.000Z'),
          localDueDate: new Date('2026-05-29T00:00:00.000Z'),
        }),
      });
    });

    it('is idempotent when today is already done', async () => {
      const prisma = prismaForCheck({ id: 'task-existing', status: TaskStatus.DONE });
      const service = new RoutinesService(prisma);

      const result = await service.checkTodayRoutine('user-1', 'routine-2');

      expect(result.task_id).toBe('task-existing');
      expect(prisma.task.create).not.toHaveBeenCalled();
      expect(prisma.task.update).not.toHaveBeenCalled();
    });

    it('marks an existing unfinished task for today as done', async () => {
      const prisma = prismaForCheck({ id: 'task-existing', status: TaskStatus.INBOX });
      const service = new RoutinesService(prisma);

      await service.checkTodayRoutine('user-1', 'routine-2');

      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-existing' },
        data: {
          status: TaskStatus.DONE,
          completedAt: new Date('2026-05-29T00:30:00.000Z'),
        },
      });
    });

    it('rejects weekday routines', async () => {
      const prisma = prismaForCheck(null, FRIDAY_ROUTINE);
      const service = new RoutinesService(prisma);

      await expect(
        service.checkTodayRoutine('user-1', 'routine-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when the routine does not exist', async () => {
      const prisma = prismaForCheck(null, null);
      const service = new RoutinesService(prisma);

      await expect(
        service.checkTodayRoutine('user-1', 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
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
          times_per_week: null,
          week_done_count: null,
          week_achieved: null,
        }),
      );
    });

    it('counts this week (Mon-Sun) and streaks achieved weeks for times-per-week routines', async () => {
      const prisma = prismaWithTimesPerWeekTasks([
        routineTask('2026-05-27'),
        routineTask('2026-05-26', TaskStatus.INBOX),
        routineTask('2026-05-25'),
        routineTask('2026-05-24'),
        routineTask('2026-05-20'),
        routineTask('2026-05-18'),
        routineTask('2026-05-14'),
        routineTask('2026-05-13'),
        routineTask('2026-05-12'),
        routineTask('2026-05-05'),
      ]);
      const service = new RoutinesService(prisma);

      const [routine] = await service.getRoutines('user-1');

      expect(routine).toEqual(
        expect.objectContaining({
          id: 'routine-2',
          times_per_week: 3,
          week_done_count: 2,
          week_achieved: false,
          streak_count: 2,
          is_due_today: false,
          last_completed_local_date: '2026-05-27',
        }),
      );
      expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it('includes the current week in the streak once it is achieved', async () => {
      const prisma = prismaWithTimesPerWeekTasks([
        routineTask('2026-05-28'),
        routineTask('2026-05-27'),
        routineTask('2026-05-25'),
        routineTask('2026-05-24'),
        routineTask('2026-05-20'),
        routineTask('2026-05-18'),
      ]);
      const service = new RoutinesService(prisma);

      const [routine] = await service.getRoutines('user-1');

      expect(routine).toEqual(
        expect.objectContaining({
          week_done_count: 3,
          week_achieved: true,
          streak_count: 2,
        }),
      );
    });

    it('does not count weeks before the routine was created', async () => {
      // 같은 제목의 예전 루틴 기록(05-11 주)이 남아 있어도 생성 주(05-18) 이전은 세지 않는다.
      const prisma = prismaWithTimesPerWeekTasks([
        routineTask('2026-05-27'),
        routineTask('2026-05-26'),
        routineTask('2026-05-25'),
        routineTask('2026-05-20'),
        routineTask('2026-05-19'),
        routineTask('2026-05-18'),
        routineTask('2026-05-13'),
        routineTask('2026-05-12'),
        routineTask('2026-05-11'),
      ]);
      prisma.routine.findMany.mockResolvedValue([
        {
          ...TIMES_PER_WEEK_ROUTINE,
          createdAt: new Date('2026-05-20T00:00:00.000Z'),
        },
      ]);
      const service = new RoutinesService(prisma);

      const [routine] = await service.getRoutines('user-1');

      // 이번 주 + 05-18 주 = 2 (경계가 없으면 05-11 주까지 3)
      expect(routine.streak_count).toBe(2);
    });
  });
});
