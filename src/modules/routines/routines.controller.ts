import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user.type';
import { CreateRoutineDto } from './dto/create-routine.dto';
import { RoutinesService } from './routines.service';

@ApiTags('Routines')
@ApiBearerAuth()
@Controller('routines')
@UseGuards(AuthGuard)
export class RoutinesController {
  constructor(private readonly routinesService: RoutinesService) {}

  @Post()
  @ApiOperation({ summary: '새 반복 루틴 생성' })
  createRoutine(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateRoutineDto,
  ) {
    return this.routinesService.createRoutine(user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: '내 루틴 목록 조회' })
  getRoutines(@CurrentUser() user: RequestUser) {
    return this.routinesService.getRoutines(user.userId);
  }

  @Post('generate-today')
  @ApiOperation({ summary: '오늘 요일에 맞는 루틴을 기반으로 Task 생성' })
  generateTodayTasks(@CurrentUser() user: RequestUser) {
    return this.routinesService.generateTodayTasks(user.userId);
  }
}