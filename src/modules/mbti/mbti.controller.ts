import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user.type';
import { ConfirmMbtiProfileDto } from './dto/confirm-mbti-profile.dto';
import { MbtiService } from './mbti.service';

@Controller('mbti')
@UseGuards(AuthGuard)
export class MbtiController {
  constructor(private readonly mbtiService: MbtiService) {}

  @Get('type-catalog')
  getTypeCatalog(@CurrentUser() currentUser: RequestUser) {
    return this.mbtiService.getTypeCatalog(currentUser.userId);
  }

  @Post('profile/confirm')
  confirmProfile(
    @CurrentUser() currentUser: RequestUser,
    @Body() body: ConfirmMbtiProfileDto,
  ) {
    return this.mbtiService.confirmProfile(currentUser.userId, body);
  }
}
