import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
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
