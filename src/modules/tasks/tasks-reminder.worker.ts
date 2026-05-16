import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

import { requestContext } from '../../common/logging/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService } from '../../infra/queue/queue.service';

@Injectable()
export class TasksReminderWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TasksReminderWorker.name);
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
      'reminders',
      (job) => this.processJob(job),
      {
        connection: this.connection,
        concurrency: 1, // 알림 발송은 순차 처리가 안전합니다
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Reminder job ${job?.id} failed: ${err.message}`, err.stack);
    });

    // 1분마다 주기적으로 실행되는 반복 작업(Cron)을 큐에 등록합니다
    const queue = this.queueService.getQueue('reminders');
    await queue.add(
      'check-due-reminders',
      {},
      {
        repeat: { pattern: '* * * * *' }, // 매 1분마다
        jobId: 'system-reminder-cron', // 중복 등록 방지를 위한 고유 ID
      },
    );

    this.logger.log('Tasks reminder worker started and cron scheduled.');
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
    const correlationId = `rmd-${job.id || randomUUID().slice(0, 8)}`;
    return requestContext.run({ correlationId }, () => this.handleJob());
  }

  private async handleJob(): Promise<void> {
    const now = new Date();

    // 1. 발송 시간이 지났으나 아직 완료되지 않은 Task를 조회합니다
    const dueTasks = await this.prismaService.task.findMany({
      where: {
        reminderAt: { lte: now },
      },
    });

    let sentCount = 0;

    for (const task of dueTasks) {
      // 완료되거나 보관된 태스크는 알림을 무시합니다 (Prisma Enum 타입 방어를 위해 문자열 검사)
      if (task.status === 'DONE' || task.status === 'ARCHIVED') continue;

      // 2. Redis를 사용해 '해당 태스크의 해당 시간 알림'이 이미 발송되었는지 확인합니다
      const redisKey = `reminder:sent:${task.id}:${task.reminderAt?.getTime()}`;
      const alreadySent = await this.connection?.get(redisKey);

      if (!alreadySent) {
        // 3. 실제 푸시 알림 발송 로직 (추후 FCM / APNs 연동 시 이곳에 구현)
        this.logger.log(
          `[PUSH NOTIFICATION] Sending reminder to user ${task.userId} for task "${task.title}"`,
        );

        // 4. 발송 완료 마킹 (30일 뒤 만료하여 Redis 메모리 관리)
        await this.connection?.set(redisKey, '1', 'EX', 60 * 60 * 24 * 30);
        sentCount++;
      }
    }

    if (sentCount > 0) {
      this.logger.log(`Successfully processed and sent ${sentCount} reminders.`);
    }
  }

  private getRedisUrl(): string {
    return this.configService.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379';
  }
}