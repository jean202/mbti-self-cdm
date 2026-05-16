import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

import { requestContext } from '../../common/logging/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService } from '../../infra/queue/queue.service';

@Injectable()
export class SessionCleanupWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionCleanupWorker.name);
  private worker?: Worker;
  private connection?: Redis;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly queueService: QueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.connection = new Redis(this.getRedisUrl(), {
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });

    this.worker = new Worker(
      'session-cleanup',
      (job) => this.processJob(job),
      {
        connection: this.connection,
        concurrency: 1, // DB 부하를 막기 위해 한 번에 하나의 정리 작업만 실행
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Session cleanup job ${job?.id} failed: ${err.message}`, err.stack);
    });

    // 매일 새벽 3시에 고아 세션 정리 작업(Cron)을 큐에 등록합니다
    const queue = this.queueService.getQueue('session-cleanup');
    await queue.add(
      'cleanup-orphans',
      {},
      {
        repeat: { pattern: '0 3 * * *' }, // 매일 03:00 실행
        jobId: 'system-session-cleanup-cron', // 중복 등록 방지
      },
    );

    this.logger.log('Session cleanup worker started and cron scheduled (03:00 AM daily).');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
    if (this.connection) {
      await this.connection.quit();
    }
  }

  private async processJob(job: Job): Promise<void> {
    const correlationId = `cln-${job.id || randomUUID().slice(0, 8)}`;
    return requestContext.run({ correlationId }, () => this.handleJob());
  }

  private async handleJob(): Promise<void> {
    this.logger.log('Starting orphan session cleanup...');

    let cursor = '0';
    let orphanCount = 0;
    const sessionPattern = 'session:*'; // 사용하는 세션 키 패턴에 맞게 조정 가능

    if (!this.connection) return;

    do {
      // KEYS 대신 SCAN을 사용하여 메인 스레드 블로킹 없이 순회
      const [nextCursor, keys] = await this.connection.scan(
        cursor,
        'MATCH',
        sessionPattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;

      for (const key of keys) {
        try {
          const sessionData = await this.connection.get(key);
          if (!sessionData) continue;

          const parsed = JSON.parse(sessionData);
          const userId = parsed.userId || parsed.user_id;

          if (userId) {
            // DB에 해당 유저가 아직 존재하는지 확인
            const userExists = await this.prismaService.user.findUnique({
              where: { id: userId },
              select: { id: true },
            });

            if (!userExists) {
              // 유저는 삭제되었는데 세션이 남아있는 경우 (고아 세션)
              await this.connection.del(key);
              orphanCount++;
              this.logger.log(`Deleted orphan session: ${key} (User ${userId} not found)`);
            }
          }
        } catch (error) {
          // JSON 파싱 에러 등은 무시하고 계속 진행
          continue;
        }
      }
    } while (cursor !== '0');

    this.logger.log(`Session cleanup completed. Removed ${orphanCount} orphan sessions.`);
  }

  private getRedisUrl(): string {
    return this.configService.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379';
  }
}