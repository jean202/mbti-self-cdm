import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user.type';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { GoalsService } from './goals.service';

@ApiTags('Goals')
@ApiBearerAuth()
@Controller('goals')
@UseGuards(AuthGuard)
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Get()
  listGoals(@CurrentUser() currentUser: RequestUser) {
    return this.goalsService.listGoals(currentUser.userId);
  }

  @Post()
  createGoal(
    @CurrentUser() currentUser: RequestUser,
    @Body() body: CreateGoalDto,
  ) {
    return this.goalsService.createGoal(currentUser.userId, body);
  }

  @Patch(':goal_id')
  updateGoal(
    @CurrentUser() currentUser: RequestUser,
    @Param('goal_id', new ParseUUIDPipe()) goalId: string,
    @Body() body: UpdateGoalDto,
  ) {
    return this.goalsService.updateGoal(currentUser.userId, goalId, body);
  }
}
