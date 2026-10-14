import { BadRequestException, type ExecutionContext, NotFoundException, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Prisma, RoutineCadenceType, TaskSourceType, TaskStatus, type Routine, type Task } from '@prisma/client';

import { AuthGuard } from '../../common/auth/auth.guard';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RoutinesController } from './routines.controller';
import { RoutinesService } from './routines.service';

const USER_ID = 'cc48bc42-1e2a-41aa-8a15-5b3e72332850';
const ROUTINE_ID = '4cbb9435-c649-4fae-8bb5-487e70393f27';
const DUE_AT = '2026-05-29T23:30:00Z'; // Saturday in Seoul, Friday in Los Angeles.
const INVALID_DUE_AT = [
  undefined, null, '', 123, {}, [], 'invalid', '2026-05-29',
  '2026-05-29T23:30:00', '2026-05-29T23:30:00.000',
  '2026-02-30T23:30:00Z', '2026-13-01T23:30:00Z',
  '2026-05-29T25:30:00Z', '2026-05-29T23:30:00+25:00',
  '2026-05-29T23:30:00+09:99',
];

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: '8aa56790-36b2-4d38-ae1d-122d7cf0d6ed', userId: USER_ID,
    title: '운동하기', note: '기존 메모', status: TaskStatus.INBOX,
    sourceType: TaskSourceType.ROUTINE, localDueDate: new Date('2026-05-30T00:00:00Z'),
    dueAt: null, completedAt: null, reminderAt: null, energyEstimate: null,
    sortOrder: null, linkedIdeaId: null, todayFocusId: null, linkedCalendarEventId: null,
    createdAt: new Date('2026-05-01T00:00:00Z'), updatedAt: new Date('2026-05-01T00:00:00Z'),
    ...overrides,
  };
}

function setup(timezone = 'Asia/Seoul') {
  const routine: Routine = {
    id: ROUTINE_ID, userId: USER_ID, name: '운동하기', note: '루틴 메모',
    cadenceType: RoutineCadenceType.CUSTOM,
    cadencePayloadJson: { timesPerWeek: 3, recommendationWindow: { mode: 'ANYTIME' } },
    isActive: true, createdAt: new Date('2026-05-01T00:00:00Z'), updatedAt: new Date('2026-05-01T00:00:00Z'),
  };
  const records: Task[] = [];
  const matches = (record: Task, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      const actual = record[key as keyof Task];
      return value instanceof Date ? actual instanceof Date && actual.getTime() === value.getTime() : actual === value;
    });
  const tx = {
    user: { findUnique: jest.fn().mockImplementation(({ where }) => where.id === USER_ID ? { id: USER_ID, timezone } : null) },
    routine: { findFirst: jest.fn().mockImplementation(({ where }) =>
      where.id === routine.id && where.userId === routine.userId ? routine : null) },
    task: {
      findFirst: jest.fn().mockImplementation(({ where }) => records.find((record) => matches(record, where)) ?? null),
      create: jest.fn().mockImplementation(({ data }) => {
        const created = task({ ...data, id: `new-task-${records.length}` });
        records.push(created);
        return created;
      }),
      update: jest.fn().mockImplementation(({ where, data }) => {
        const index = records.findIndex((record) => matches(record, where));
        if (index < 0) throw new Error('Unscoped task update');
        records[index] = { ...records[index], ...data };
        return records[index];
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
  };
  const service = new RoutinesService(prisma as unknown as PrismaService);
  const schedule = (dueAt: unknown = DUE_AT, userId = USER_ID, routineId = ROUTINE_ID) =>
    service.scheduleRoutine(userId, routineId, dueAt as string);
  return { service, prisma, tx, routine, records, schedule };
}

describe('RoutinesService scheduling', () => {
  it.each([
    ['Asia/Seoul', '2026-05-30T00:00:00Z'],
    ['America/Los_Angeles', '2026-05-29T00:00:00Z'],
  ])('creates a pending task on the selected date in %s without completing it', async (timezone, localDueDate) => {
    const { schedule, records, tx, prisma } = setup(timezone);
    const result = await schedule();
    expect(result).toMatchObject({
      userId: USER_ID, title: '운동하기', note: '루틴 메모',
      sourceType: TaskSourceType.ROUTINE, status: TaskStatus.INBOX,
      dueAt: new Date(DUE_AT), localDueDate: new Date(localDueDate), completedAt: null,
    });
    expect(records).toHaveLength(1);
    expect(tx.task.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });

  it('reuses one pending task for repeated requests and changes only its dueAt', async () => {
    const { schedule, records, tx } = setup();
    const first = await schedule();
    const repeated = await schedule();
    const changed = await schedule('2026-05-30T12:00:00+09:00');
    expect(repeated.id).toBe(first.id);
    expect(changed).toEqual({ ...first, dueAt: new Date('2026-05-30T03:00:00Z') });
    expect(records).toHaveLength(1);
    expect(tx.task.create).toHaveBeenCalledTimes(1);
    expect(tx.task.update).toHaveBeenLastCalledWith({
      where: { id: first.id, userId: USER_ID }, data: { dueAt: new Date('2026-05-30T03:00:00Z') },
    });
  });

  it.each([TaskStatus.INBOX, TaskStatus.PLANNED])('preserves existing %s task metadata and status', async (status) => {
    const { schedule, records, tx } = setup();
    const existing = task({ status, reminderAt: new Date('2026-05-29T22:00:00Z'), sortOrder: 7 });
    records.push(existing);
    expect(await schedule()).toEqual({ ...existing, dueAt: new Date(DUE_AT) });
    expect(tx.task.create).not.toHaveBeenCalled();
  });

  it.each([TaskStatus.DONE, TaskStatus.ARCHIVED])('rejects %s tasks without changing any history', async (status) => {
    const { schedule, records, tx } = setup();
    records.push(task({ status, completedAt: status === TaskStatus.DONE ? new Date(DUE_AT) : null }));
    const before = structuredClone(records);
    await expect(schedule()).rejects.toBeInstanceOf(BadRequestException);
    expect(records).toEqual(before);
    expect(tx.task.create).not.toHaveBeenCalled();
    expect(tx.task.update).not.toHaveBeenCalled();
  });

  it('isolates lookup by owner, title, source and local due date and leaves old records intact', async () => {
    const { schedule, records, tx } = setup();
    records.push(
      task({ id: 'other-owner', userId: 'other-user' }),
      task({ id: 'other-title', title: '다른 루틴' }),
      task({ id: 'manual', sourceType: TaskSourceType.MANUAL }),
      task({ id: 'history', status: TaskStatus.DONE, localDueDate: new Date('2026-05-29T00:00:00Z'), completedAt: new Date('2026-05-29T01:00:00Z') }),
    );
    const before = structuredClone(records);
    const result = await schedule();
    expect(result.id).toBe('new-task-4');
    expect(records.slice(0, 4)).toEqual(before);
    expect(tx.task.findFirst).toHaveBeenCalledWith({ where: {
      userId: USER_ID, title: '운동하기', sourceType: TaskSourceType.ROUTINE,
      localDueDate: new Date('2026-05-30T00:00:00Z'),
    } });
    expect(tx.task.update).not.toHaveBeenCalled();
  });

  it.each(['other-routine', ROUTINE_ID])('rejects missing or another owner routine: %s', async (routineId) => {
    const { schedule, records, routine } = setup();
    if (routineId === ROUTINE_ID) routine.userId = 'other-user';
    await expect(schedule(DUE_AT, USER_ID, routineId)).rejects.toBeInstanceOf(NotFoundException);
    expect(records).toEqual([]);
  });

  it('rejects an inactive routine without creating a task', async () => {
    const { schedule, records, routine } = setup();
    routine.isActive = false;
    await expect(schedule()).rejects.toBeInstanceOf(BadRequestException);
    expect(records).toEqual([]);
  });

  it('rejects a missing user', async () => {
    const { schedule, records } = setup();
    await expect(schedule(DUE_AT, 'missing-user')).rejects.toBeInstanceOf(NotFoundException);
    expect(records).toEqual([]);
  });

  it.each(INVALID_DUE_AT.filter((value) => value !== undefined).map((value) => [value]))('rejects malformed timestamps at the service boundary: %j', async (dueAt) => {
    const { schedule, prisma } = setup();
    await expect(schedule(dueAt)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['Asia/Seoul', [6], true],
    ['Asia/Seoul', [5], false],
    ['America/Los_Angeles', [5], true],
    ['America/Los_Angeles', [6], false],
    ['Asia/Seoul', [], false],
  ])('checks selected local weekday in %s for %j (due=%s)', async (timezone, daysOfWeek, due) => {
    const { schedule, routine, records } = setup(timezone as string);
    routine.cadenceType = RoutineCadenceType.WEEKLY;
    routine.cadencePayloadJson = { daysOfWeek: daysOfWeek as number[] };
    if (due) {
      expect(await schedule()).toMatchObject({ status: TaskStatus.INBOX });
      expect(records).toHaveLength(1);
    } else {
      await expect(schedule()).rejects.toBeInstanceOf(BadRequestException);
      expect(records).toEqual([]);
    }
  });

  it('retries a serialization conflict and returns a single pending task', async () => {
    const { schedule, prisma, records } = setup();
    prisma.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Serialization conflict', { code: 'P2034', clientVersion: '6.19.2' }));
    expect(await schedule()).toMatchObject({ status: TaskStatus.INBOX });
    expect(records).toHaveLength(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('bounds retries and propagates persistent transaction conflicts', async () => {
    const { schedule, prisma, records } = setup();
    const conflict = new Prisma.PrismaClientKnownRequestError('Serialization conflict', { code: 'P2034', clientVersion: '6.19.2' });
    prisma.$transaction.mockRejectedValue(conflict);
    await expect(schedule()).rejects.toBe(conflict);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(records).toEqual([]);
  });

  it('does not retry unrelated database errors', async () => {
    const { schedule, prisma } = setup();
    const error = new Error('Database unavailable');
    prisma.$transaction.mockRejectedValue(error);
    await expect(schedule()).rejects.toBe(error);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('Routines scheduling POST HTTP contract', () => {
  const fixture = setup('America/Los_Angeles');
  const url = `/v1/routines/${ROUTINE_ID}/schedule`;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [RoutinesController],
      providers: [{ provide: RoutinesService, useValue: fixture.service }],
    }).overrideGuard(AuthGuard).useValue({
      canActivate(context: ExecutionContext) {
        context.switchToHttp().getRequest().user = { userId: USER_ID, sessionId: 'session-1' };
        return true;
      },
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(() => { fixture.records.length = 0; jest.clearAllMocks(); });
  afterAll(async () => app.close());

  it.each([DUE_AT, '2026-05-30T08:30:00+09:00', '2026-05-29T16:30:00-07:00'])('accepts an explicit timezone, uses the authenticated owner and selected timezone: %s', async (dueAt) => {
    const response = await app.inject({ method: 'POST', url, payload: { dueAt, userId: 'attacker', local_date: '2026-01-01' } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: 'new-task-0', userId: USER_ID, status: TaskStatus.INBOX, completedAt: null,
      dueAt: DUE_AT.replace('Z', '.000Z'), localDueDate: '2026-05-29T00:00:00.000Z',
    });
    expect(fixture.records).toHaveLength(1);
  });

  it.each(INVALID_DUE_AT.map((value) => [value]))('rejects malformed or naive dueAt without starting a transaction: %j', async (dueAt) => {
    const response = await app.inject({ method: 'POST', url, payload: dueAt === undefined ? {} : { dueAt } });
    expect(response.statusCode).toBe(400);
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
    expect(fixture.records).toEqual([]);
  });

  it('rejects malformed UUIDs without starting a transaction', async () => {
    const response = await app.inject({ method: 'POST', url: '/v1/routines/invalid/schedule', payload: { dueAt: DUE_AT } });
    expect(response.statusCode).toBe(400);
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns 404 for another owner routine and preserves records', async () => {
    const response = await app.inject({ method: 'POST', url: '/v1/routines/02783f15-2e58-469c-9124-f7fe6259b67b/schedule', payload: { dueAt: DUE_AT } });
    expect(response.statusCode).toBe(404);
    expect(fixture.records).toEqual([]);
  });
});
