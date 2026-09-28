import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user.type';
import { RecordVideoSuggestionFeedbackDto } from './dto/record-video-suggestion-feedback.dto';
import { VideoSuggestionsService } from './video-suggestions.service';

@ApiTags('Home')
@ApiBearerAuth()
@Controller('home/video-suggestion')
@UseGuards(AuthGuard)
export class VideoSuggestionsController {
  constructor(
    private readonly videoSuggestionsService: VideoSuggestionsService,
  ) {}

  @Post('feedback')
  recordFeedback(
    @CurrentUser() currentUser: RequestUser,
    @Body() body: RecordVideoSuggestionFeedbackDto,
  ) {
    return this.videoSuggestionsService.recordFeedback(
      currentUser.userId,
      body,
    );
  }
}
