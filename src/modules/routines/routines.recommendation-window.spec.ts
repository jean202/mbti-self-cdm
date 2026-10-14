import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RoutineCadenceType, TaskSourceType, TaskStatus, type Routine } from '@prisma/client';

import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreateRoutineDto } from './dto/create-routine.dto';
import { RoutinesService } from './routines.service';

const WINDOWS = [
  { mode: 'CLOCK', startMinutes: 1320, endMinutes: 120 },
  { mode: 'AFTER_WAKE', durationMinutes: 1 },
  { mode: 'BEFORE_SLEEP', durationMinutes: 1440 },
  { mode: 'ANYTIME' },
];

const INVALID_WINDOWS = [
  'CLOCK', 1, false, [], {}, { mode: 'UNKNOWN' },
  { mode: 'CLOCK', startMinutes: 0 },
  { mode: 'CLOCK', endMinutes: 60 },
  { mode: 'CLOCK', startMinutes: 60, endMinutes: 60 },
  { mode: 'CLOCK', startMinutes: -1, endMinutes: 60 },
  { mode: 'CLOCK', startMinutes: 1440, endMinutes: 60 },
  { mode: 'CLOCK', startMinutes: 0, endMinutes: -1 },
  { mode: 'CLOCK', startMinutes: 0, endMinutes: 1440 },
  { mode: 'CLOCK', startMinutes: 0.5, endMinutes: 60 },
  { mode: 'CLOCK', startMinutes: 0, endMinutes: 60.5 },
  { mode: 'CLOCK', startMinutes: '0', endMinutes: 60 },
  { mode: 'CLOCK', startMinutes: 0, endMinutes: null },
  { mode: 'CLOCK', startMinutes: 0, endMinutes: 60, durationMinutes: 1 },
  { mode: 'AFTER_WAKE' },
  { mode: 'AFTER_WAKE', durationMinutes: 0 },
  { mode: 'AFTER_WAKE', durationMinutes: 1441 },
  { mode: 'AFTER_WAKE', durationMinutes: 0.5 },
  { mode: 'AFTER_WAKE', durationMinutes: '60' },
  { mode: 'BEFORE_SLEEP' },
  { mode: 'BEFORE_SLEEP', durationMinutes: 0 },
  { mode: 'BEFORE_SLEEP', durationMinutes: 1441 },
  { mode: 'BEFORE_SLEEP', durationMinutes: null },
  { mode: 'BEFORE_SLEEP', durationMinutes: 60, endMinutes: 0 },
  { mode: 'ANYTIME', durationMinutes: 60 },
  { mode: 'ANYTIME', extra: true },
  { mode: 'CLOCK', startMinutes: NaN, endMinutes: 60 },
  { mode: 'BEFORE_SLEEP', durationMinutes: Infinity },
];

function setup(cadence: 'WEEKLY' | 'CUSTOM' = 'CUSTOM') {
  let stored: Routine = {
    id: 'routine-1', userId: 'user-1', name: '운동하기', note: '메모',
    cadenceType: RoutineCadenceType[cadence],
    cadencePayloadJson: cadence === 'CUSTOM'
      ? { timesPerWeek: 3, customKey: { keep: true } }
      : { daysOfWeek: [1, 3], customKey: { keep: true } },
    isActive: true,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
  };
  const records = [{
    id: 'task-1', userId: 'user-1', title: '운동하기',
    status: TaskStatus.DONE, sourceType: TaskSourceType.ROUTINE,
    localDueDate: new Date('2026-05-25T00:00:00Z'), dueAt: null,
    completedAt: new Date('2026-05-25T12:00:00Z'),
    createdAt: new Date('2026-05-25T00:00:00Z'),
  }];
  const matches = (where: { id?: string; userId: string }) =>
    where.userId === stored.userId && (!where.id || where.id === stored.id);
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', timezone: 'Asia/Seoul' }) },
    routine: {
      create: jest.fn().mockImplementation(({ data }) => {
        stored = { ...stored, ...data };
        return stored;
      }),
      findFirst: jest.fn().mockImplementation(({ where }) => matches(where) ? stored : null),
      findMany: jest.fn().mockImplementation(({ where }) => matches(where) ? [stored] : []),
      update: jest.fn().mockImplementation(({ where, data }) => {
        if (!matches(where)) throw new Error('Unscoped routine update');
        stored = { ...stored, ...data };
        return stored;
      }),
    },
    task: {
      findMany: jest.fn().mockImplementation(() => structuredClone(records)),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => ({ ...data, id: 'task-new' })),
      update: jest.fn(), delete: jest.fn(), deleteMany: jest.fn(), updateMany: jest.fn(),
    },
  };
  const service = new RoutinesService(prisma as unknown as PrismaService);
  const update = (dto: unknown, userId = 'user-1', routineId = 'routine-1') =>
    service.updateRecommendationWindow(userId, routineId, dto as Parameters<RoutinesService['updateRecommendationWindow']>[2]);
  const expectNoTaskMutations = () => {
    for (const method of ['create', 'update', 'delete', 'deleteMany', 'updateMany'] as const) {
      expect(prisma.task[method]).not.toHaveBeenCalled();
    }
  };
  return { service, prisma, update, records, stored: () => structuredClone(stored), expectNoTaskMutations };
}

describe('Routine recommendation windows', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(Date.parse('2026-05-29T00:30:00Z')));
  afterEach(() => jest.useRealTimers());

  describe('create and read', () => {
    it.each(WINDOWS)('roundtrips a recommendation window and preserves the create response: %j', async (window) => {
      const { service, stored, expectNoTaskMutations } = setup();
      const created = await service.createRoutine('user-1', {
        title: '운동하기', timesPerWeek: 3, recommendationWindow: window,
      } as CreateRoutineDto);
      expect(created).toEqual(stored());
      expect(created.cadencePayloadJson).toEqual({ timesPerWeek: 3, recommendationWindow: window });
      const [read] = await service.getRoutines('user-1', '2026-05-29');
      expect(read).toMatchObject({
        recommendation_window: window,
        cadencePayloadJson: { timesPerWeek: 3, recommendationWindow: window },
        times_per_week: 3, week_done_count: 1,
      });
      expectNoTaskMutations();
    });

    it('adds a window without changing weekday cadence', async () => {
      const { service } = setup('WEEKLY');
      const created = await service.createRoutine('user-1', {
        title: '운동하기', daysOfWeek: [1, 3], recommendationWindow: { mode: 'ANYTIME' },
      });
      expect(created).toMatchObject({
        cadenceType: RoutineCadenceType.WEEKLY,
        cadencePayloadJson: { daysOfWeek: [1, 3], recommendationWindow: { mode: 'ANYTIME' } },
      });
    });

    it('omits the JSON key when create does not provide a window', async () => {
      const { service } = setup();
      const created = await service.createRoutine('user-1', { title: '운동하기', timesPerWeek: 3 });
      expect(created.cadencePayloadJson).toEqual({ timesPerWeek: 3 });
      const [read] = await service.getRoutines('user-1');
      expect(read).toHaveProperty('recommendation_window', null);
    });

    it('stores explicit null on create and reads it as no recommendations', async () => {
      const { service } = setup();
      const created = await service.createRoutine('user-1', {
        title: '운동하기', timesPerWeek: 3, recommendationWindow: null,
      });
      expect(created.cadencePayloadJson).toEqual({ timesPerWeek: 3, recommendationWindow: null });
      const [read] = await service.getRoutines('user-1');
      expect(read).toHaveProperty('recommendation_window', null);
    });

    it.each(INVALID_WINDOWS.map((window) => [window]))('rejects bad input at the create service boundary: %j', async (window) => {
      const { service, prisma } = setup();
      await expect(service.createRoutine('user-1', {
        title: '운동하기', timesPerWeek: 3, recommendationWindow: window,
      } as CreateRoutineDto)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.routine.create).not.toHaveBeenCalled();
    });
  });

  describe('update and clear', () => {
    it.each(['WEEKLY', 'CUSTOM'] as const)('preserves %s cadence, other keys and completion records on update and clear', async (cadence) => {
      const { service, update, stored, records, expectNoTaskMutations, prisma } = setup(cadence);
      const before = stored();
      const previousRecords = structuredClone(records);
      for (const window of [...WINDOWS, null]) {
        const result = await update({ recommendationWindow: window });
        expect(result).toEqual(stored());
        expect(stored()).toMatchObject({
          cadenceType: before.cadenceType, name: before.name, note: before.note,
          isActive: before.isActive, cadencePayloadJson: before.cadencePayloadJson,
        });
        const [read] = await service.getRoutines('user-1', '2026-05-29');
        expect(read).toHaveProperty('recommendation_window', window);
        expect(read.cadencePayloadJson).toMatchObject(before.cadencePayloadJson!);
        expect(read.last_completed_local_date).toBe('2026-05-25');
        if (cadence === 'CUSTOM') {
          expect(read).toMatchObject({ times_per_week: 3, week_done_count: 1 });
        }
      }
      expect(prisma.routine.update).toHaveBeenLastCalledWith({
        where: { id: 'routine-1', userId: 'user-1' },
        data: { cadencePayloadJson: before.cadencePayloadJson },
      });
      expect(records).toEqual(previousRecords);
      expectNoTaskMutations();
    });

    it.each([{}, { recommendationWindow: undefined }, null, undefined])('rejects missing patch field at the service boundary: %j', async (dto) => {
      const { update, prisma, expectNoTaskMutations } = setup();
      await expect(update(dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.routine.update).not.toHaveBeenCalled();
      expectNoTaskMutations();
    });

    it.each(INVALID_WINDOWS.map((window) => [window]))('rejects bad input at the update service boundary: %j', async (window) => {
      const { update, prisma, expectNoTaskMutations } = setup();
      await expect(update({ recommendationWindow: window })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.routine.update).not.toHaveBeenCalled();
      expectNoTaskMutations();
    });

    it.each([['user-2', 'routine-1'], ['user-1', 'missing']])('returns not found for inaccessible routine (%s, %s)', async (userId, routineId) => {
      const { update, prisma, stored, expectNoTaskMutations } = setup();
      const before = stored();
      await expect(update({ recommendationWindow: { mode: 'ANYTIME' } }, userId, routineId)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.routine.findFirst).toHaveBeenCalledWith({ where: { id: routineId, userId } });
      expect(prisma.routine.update).not.toHaveBeenCalled();
      expect(stored()).toEqual(before);
      expectNoTaskMutations();
    });

    it('still completes manually outside the recommendation window', async () => {
      const { service, update, prisma } = setup();
      // Local time is 09:30; the recommendation is 22:00-02:00.
      await update({ recommendationWindow: WINDOWS[0] });
      const result = await service.checkTodayRoutine('user-1', 'routine-1', '2026-05-29');
      expect(result).toMatchObject({ routine_id: 'routine-1', task_id: 'task-new' });
      expect(prisma.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: TaskStatus.DONE, completedAt: new Date('2026-05-29T00:30:00Z') }),
      });
    });
  });
});
