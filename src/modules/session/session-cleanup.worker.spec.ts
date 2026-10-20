import { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { QueueService } from '../../infra/queue/queue.service';
import type { RedisService } from '../../infra/redis/redis.service';
import { FakeRedis } from '../../testing/fake-redis';
import { AuthTokenService } from '../auth/auth-token.service';
import { SessionCleanupWorker } from './session-cleanup.worker';
import { SessionService } from './session.service';

describe('SessionCleanupWorker', () => {
  const existingUsers = new Set(['user-alive']);
  let redis: FakeRedis;
  let sessions: SessionService;
  let worker: SessionCleanupWorker;
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(() => {
    redis = new FakeRedis();
    sessions = new SessionService(
      { getClient: () => redis } as unknown as RedisService,
      new AuthTokenService({ get: jest.fn() } as unknown as ConfigService),
    );
    prisma = {
      user: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
          existingUsers.has(where.id) ? { id: where.id } : null,
        ),
      },
    };
    worker = new SessionCleanupWorker(
      prisma as unknown as PrismaService,
      { get: jest.fn() } as unknown as ConfigService,
      {} as QueueService,
    );
    // onModuleInit 없이 정리 로직만 검증한다.
    (worker as unknown as { connection: FakeRedis }).connection = redis;
  });

  function runCleanup(): Promise<void> {
    return (worker as unknown as { handleJob: () => Promise<void> }).handleJob();
  }

  it('deletes sessions created by SessionService for users that no longer exist', async () => {
    const orphan = await sessions.createSession({
      userId: 'user-deleted',
      platform: 'IOS',
      appVersion: '1.0.0',
    });
    const alive = await sessions.createSession({
      userId: 'user-alive',
      platform: 'IOS',
      appVersion: '1.0.0',
    });

    await runCleanup();

    expect(redis.strings.has(`auth:session:${orphan.session_id}`)).toBe(false);
    expect(await redis.smembers('auth:user-sessions:user-deleted')).toEqual([]);
    await expect(
      sessions.validateAccessSession(alive.session_id, 'user-alive'),
    ).resolves.toBeDefined();
  });

  it('skips unreadable session payloads and keeps going', async () => {
    await redis.set('auth:session:broken', '{not json');
    const orphan = await sessions.createSession({
      userId: 'user-deleted',
      platform: 'IOS',
      appVersion: '1.0.0',
    });

    await expect(runCleanup()).resolves.toBeUndefined();

    expect(redis.strings.has('auth:session:broken')).toBe(true);
    expect(redis.strings.has(`auth:session:${orphan.session_id}`)).toBe(false);
  });

  it('ignores keys outside the session namespace', async () => {
    await redis.set('reminder:sent:task-1:1700000000000', '1');
    await redis.set(
      'oauth_state:GOOGLE:flow-1',
      JSON.stringify({ user_id: 'user-deleted' }),
    );

    await runCleanup();

    expect(redis.strings.size).toBe(2);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
