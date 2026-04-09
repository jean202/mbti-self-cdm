import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user.type';
import { PlanBacklogQueryDto } from './dto/plan-backlog-query.dto';
import { PlanTodayQueryDto } from './dto/plan-today-query.dto';
import { PlanWeekQueryDto } from './dto/plan-week-query.dto';
import { ReorderTasksDto } from './dto/reorder-tasks.dto';
import { PlanService } from './plan.service';

@ApiTags('Plan')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard)
export class PlanController {
  constructor(private readonly planService: PlanService) {}

  @Get('plan/today')
  getToday(
    @CurrentUser() currentUser: RequestUser,
    @Query() query: PlanTodayQueryDto,
  ) {
    return this.planService.getToday(currentUser.userId, query.local_date);
  }

  @Get('plan/week')
  getWeek(
    @CurrentUser() currentUser: RequestUser,
    @Query() query: PlanWeekQueryDto,
  ) {
    return this.planService.getWeek(currentUser.userId, query);
  }

  @Get('plan/backlog')
  getBacklog(
    @CurrentUser() currentUser: RequestUser,
    @Query() query: PlanBacklogQueryDto,
  ) {
    return this.planService.getBacklog(currentUser.userId, query);
  }

  @Post('tasks/reorder')
  reorderTasks(
    @CurrentUser() currentUser: RequestUser,
    @Body() body: ReorderTasksDto,
  ) {
    return this.planService.reorderTasks(currentUser.userId, body);
  }
}
