import { Body, Controller, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user.type';
import { UpsertTodayFocusDto } from './dto/upsert-today-focus.dto';
import { HomeService } from './home.service';

@ApiTags('Home')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard)
export class TodayFocusController {
  constructor(private readonly homeService: HomeService) {}

  @Put('today-focus')
  upsertTodayFocus(
    @CurrentUser() currentUser: RequestUser,
    @Body() body: UpsertTodayFocusDto,
  ) {
    return this.homeService.upsertTodayFocus(currentUser.userId, body);
  }
}
