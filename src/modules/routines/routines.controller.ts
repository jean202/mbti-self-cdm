import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

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
  @ApiQuery({ name: 'local_date', required: false, example: '2026-10-11' })
  getRoutines(@CurrentUser() user: RequestUser, @Query('local_date') localDate?: string) {
    return this.routinesService.getRoutines(user.userId, localDate);
  }

  @Post('generate-today')
  @ApiOperation({ summary: '오늘 요일에 맞는 루틴을 기반으로 Task 생성' })
  @ApiQuery({ name: 'local_date', required: false, example: '2026-10-11' })
  generateTodayTasks(@CurrentUser() user: RequestUser, @Query('local_date') localDate?: string) {
    return this.routinesService.generateTodayTasks(user.userId, localDate);
  }

  @Post(':routine_id/skip-today')
  @ApiOperation({ summary: '오늘 루틴 건너뛰기' })
  @ApiQuery({ name: 'local_date', required: false, example: '2026-10-11' })
  skipTodayRoutine(
    @CurrentUser() user: RequestUser,
    @Param('routine_id', new ParseUUIDPipe()) routineId: string,
    @Query('local_date') localDate?: string,
  ) {
    return this.routinesService.skipTodayRoutine(user.userId, routineId, localDate);
  }

  @Post(':routine_id/check-today')
  @ApiOperation({ summary: '주 N회 루틴 오늘 수행 기록' })
  @ApiQuery({ name: 'local_date', required: false, example: '2026-10-11' })
  checkTodayRoutine(
    @CurrentUser() user: RequestUser,
    @Param('routine_id', new ParseUUIDPipe()) routineId: string,
    @Query('local_date') localDate?: string,
  ) {
    return this.routinesService.checkTodayRoutine(user.userId, routineId, localDate);
  }
}
