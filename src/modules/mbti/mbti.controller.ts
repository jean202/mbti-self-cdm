import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user.type';
import { ConfirmMbtiProfileDto } from './dto/confirm-mbti-profile.dto';
import { SelfSelectMbtiProfileDto } from './dto/self-select-mbti-profile.dto';
import { StartMbtiFinderAttemptDto } from './dto/start-mbti-finder-attempt.dto';
import { SubmitMbtiFinderAnswersDto } from './dto/submit-mbti-finder-answers.dto';
import { MbtiService } from './mbti.service';

@ApiTags('MBTI')
@ApiBearerAuth()
@Controller('mbti')
@UseGuards(AuthGuard)
export class MbtiController {
  constructor(private readonly mbtiService: MbtiService) {}

  @Get('type-catalog')
  getTypeCatalog(@CurrentUser() currentUser: RequestUser) {
    return this.mbtiService.getTypeCatalog(currentUser.userId);
  }

  @Post('profile/self-selection')
  selfSelectProfile(
    @CurrentUser() currentUser: RequestUser,
    @Body() body: SelfSelectMbtiProfileDto,
  ) {
    return this.mbtiService.selfSelectProfile(currentUser.userId, body);
  }

  @Post('finder/attempts')
  startFinderAttempt(
    @CurrentUser() currentUser: RequestUser,
    @Body() body: StartMbtiFinderAttemptDto,
  ) {
    return this.mbtiService.startFinderAttempt(currentUser.userId, body);
  }

  @Get('finder/attempts/:attempt_id')
  getFinderAttempt(
    @CurrentUser() currentUser: RequestUser,
    @Param('attempt_id') attemptId: string,
  ) {
    return this.mbtiService.getFinderAttempt(currentUser.userId, attemptId);
  }

  @Post('finder/attempts/:attempt_id/answers')
  submitFinderAnswers(
    @CurrentUser() currentUser: RequestUser,
    @Param('attempt_id') attemptId: string,
    @Body() body: SubmitMbtiFinderAnswersDto,
  ) {
    return this.mbtiService.submitFinderAnswers(
      currentUser.userId,
      attemptId,
      body,
    );
  }

  @Post('finder/attempts/:attempt_id/complete')
  completeFinderAttempt(
    @CurrentUser() currentUser: RequestUser,
    @Param('attempt_id') attemptId: string,
  ) {
    return this.mbtiService.completeFinderAttempt(currentUser.userId, attemptId);
  }

  @Post('profile/confirm')
  confirmProfile(
    @CurrentUser() currentUser: RequestUser,
    @Body() body: ConfirmMbtiProfileDto,
  ) {
    return this.mbtiService.confirmProfile(currentUser.userId, body);
  }
}
