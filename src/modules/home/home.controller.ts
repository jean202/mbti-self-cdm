import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user.type';
import { HomeQueryDto } from './dto/home-query.dto';
import { HomeService } from './home.service';

@ApiTags('Home')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard)
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @Get('home')
  getHome(
    @CurrentUser() currentUser: RequestUser,
    @Query() query: HomeQueryDto,
  ) {
    return this.homeService.getHome(currentUser.userId, query.local_date);
  }
}
