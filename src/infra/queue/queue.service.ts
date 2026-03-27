import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private connection?: Redis;
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly configService: ConfigService) {}

  getQueue(name: string): Queue {
    const existingQueue = this.queues.get(name);

    if (existingQueue) {
      return existingQueue;
    }

    const queue = new Queue(name, {
      connection: this.getConnection(),
    });

    this.queues.set(name, queue);

    return queue;
  }

  async onModuleDestroy(): Promise<void> {
    for (const queue of this.queues.values()) {
      await queue.close();
    }

    if (this.connection) {
      await this.connection.quit();
    }
  }

  private getConnection(): Redis {
    if (!this.connection) {
      this.connection = new Redis(this.getRedisUrl(), {
        lazyConnect: true,
        maxRetriesPerRequest: null,
      });
    }

    return this.connection;
  }

  private getRedisUrl(): string {
    return (
      this.configService.get<string>('REDIS_URL') ??
      'redis://127.0.0.1:6379'
    );
  }
}
