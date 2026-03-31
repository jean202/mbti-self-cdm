import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user.type';
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

@Controller('tasks')
@UseGuards(AuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  createTask(@CurrentUser() currentUser: RequestUser, @Body() body: CreateTaskDto) {
    return this.tasksService.createTask(currentUser.userId, body);
  }

  @Get()
  listTasks(
    @CurrentUser() currentUser: RequestUser,
    @Query() query: ListTasksQueryDto,
  ) {
    return this.tasksService.listTasks(currentUser.userId, query);
  }

  @Get(':task_id')
  getTask(
    @CurrentUser() currentUser: RequestUser,
    @Param('task_id', new ParseUUIDPipe()) taskId: string,
  ) {
    return this.tasksService.getTask(currentUser.userId, taskId);
  }

  @Patch(':task_id')
  updateTask(
    @CurrentUser() currentUser: RequestUser,
    @Param('task_id', new ParseUUIDPipe()) taskId: string,
    @Body() body: UpdateTaskDto,
  ) {
    return this.tasksService.updateTask(currentUser.userId, taskId, body);
  }
}
