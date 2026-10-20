import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { QueueService } from '../../infra/queue/queue.service';
import { FakeRedis } from '../../testing/fake-redis';
import { TasksReminderWorker } from './tasks-reminder.worker';

const REMINDER_AT = new Date('2026-10-20T09:00:00.000Z');

function task(id: string, status: string, reminderAt: Date | null = REMINDER_AT) {
  return { id, userId: 'user-1', title: `task ${id}`, status, reminderAt };
}

describe('TasksReminderWorker', () => {
  let redis: FakeRedis;
  let findMany: jest.Mock;
  let worker: TasksReminderWorker;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    redis = new FakeRedis();
    findMany = jest.fn();
    worker = new TasksReminderWorker(
      { task: { findMany } } as unknown as PrismaService,
      { get: jest.fn() } as unknown as ConfigService,
      {} as QueueService,
    );
    (worker as unknown as { connection: FakeRedis }).connection = redis;
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function runOnce(): Promise<void> {
    return (worker as unknown as { handleJob: () => Promise<void> }).handleJob();
  }

  function pushes(): string[] {
    return logSpy.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.startsWith('[PUSH NOTIFICATION]'));
  }

  it('queries only reminders that are already due', async () => {
    findMany.mockResolvedValue([]);
    const before = Date.now();

    await runOnce();

    const { where } = findMany.mock.calls[0][0];
    expect(where.reminderAt.lte.getTime()).toBeGreaterThanOrEqual(before);
    expect(where.reminderAt.lte.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('sends due reminders once and skips finished tasks', async () => {
    findMany.mockResolvedValue([
      task('todo', 'PLANNED'),
      task('done', 'DONE'),
      task('archived', 'ARCHIVED'),
    ]);

    await runOnce();

    expect(pushes()).toEqual([
      '[PUSH NOTIFICATION] Sending reminder to user user-1 for task "task todo"',
    ]);
    const sentKey = `reminder:sent:todo:${REMINDER_AT.getTime()}`;
    expect(await redis.get(sentKey)).toBe('1');
    expect(redis.ttls.get(sentKey)).toBe(60 * 60 * 24 * 30);
  });

  it('does not resend the same reminder on the next tick', async () => {
    findMany.mockResolvedValue([task('todo', 'PLANNED')]);

    await runOnce();
    await runOnce();

    expect(pushes()).toHaveLength(1);
  });

  it('sends again when the reminder time is moved', async () => {
    findMany.mockResolvedValueOnce([task('todo', 'PLANNED')]);
    await runOnce();

    findMany.mockResolvedValueOnce([
      task('todo', 'PLANNED', new Date('2026-10-20T10:00:00.000Z')),
    ]);
    await runOnce();

    expect(pushes()).toHaveLength(2);
  });
});
