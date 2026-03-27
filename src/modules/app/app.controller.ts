import { Controller, Get, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user.type';
import { AppService } from './app.service';

@Controller('app')
@UseGuards(AuthGuard)
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('bootstrap')
  getBootstrap(@CurrentUser() currentUser: RequestUser) {
    return this.appService.getBootstrap(currentUser.userId);
  }
}
