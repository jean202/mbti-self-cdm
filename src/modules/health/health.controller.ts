import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth() {
    return {
      service: 'mbti-self-cdm-backend',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
