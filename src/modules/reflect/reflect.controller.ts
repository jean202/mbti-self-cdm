import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user.type';
import { CreateMoodEnergyCheckDto } from './dto/create-mood-energy-check.dto';
import { UpsertReflectionDto } from './dto/upsert-reflection.dto';
import { ReflectService } from './reflect.service';

@ApiTags('Reflect')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard)
export class ReflectController {
  constructor(private readonly reflectService: ReflectService) {}

  @Get('reflect/daily')
  getDaily(
    @CurrentUser() currentUser: RequestUser,
    @Query('local_date') localDate?: string,
  ) {
    return this.reflectService.getDaily(currentUser.userId, localDate);
  }

  @Post('mood-energy-checks')
  createMoodEnergyCheck(
    @CurrentUser() currentUser: RequestUser,
    @Body() body: CreateMoodEnergyCheckDto,
  ) {
    return this.reflectService.createMoodEnergyCheck(
      currentUser.userId,
      body,
    );
  }

  @Put('reflections/:local_date')
  upsertReflection(
    @CurrentUser() currentUser: RequestUser,
    @Param('local_date') localDate: string,
    @Body() body: UpsertReflectionDto,
  ) {
    return this.reflectService.upsertReflection(
      currentUser.userId,
      localDate,
      body,
    );
  }
}
