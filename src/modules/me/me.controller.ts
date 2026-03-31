import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user.type';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { MeService } from './me.service';

@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get()
  getMe(@CurrentUser() currentUser: RequestUser) {
    return this.meService.getMe(currentUser.userId);
  }

  @Patch('preferences')
  updatePreferences(
    @CurrentUser() currentUser: RequestUser,
    @Body() body: UpdatePreferencesDto,
  ) {
    return this.meService.updatePreferences(currentUser.userId, body);
  }
}
