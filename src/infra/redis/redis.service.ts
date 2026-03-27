import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private client?: Redis;

  constructor(private readonly configService: ConfigService) {}

  getClient(): Redis {
    if (!this.client) {
      this.client = new Redis(this.getRedisUrl(), {
        lazyConnect: true,
        maxRetriesPerRequest: null,
      });
    }

    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
    }
  }

  private getRedisUrl(): string {
    return (
      this.configService.get<string>('REDIS_URL') ??
      'redis://127.0.0.1:6379'
    );
  }
}
