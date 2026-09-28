import { Module } from '@nestjs/common';

import { VideoSuggestionsController } from './video-suggestions.controller';
import { VideoSuggestionsService } from './video-suggestions.service';

@Module({
  controllers: [VideoSuggestionsController],
  providers: [VideoSuggestionsService],
  exports: [VideoSuggestionsService],
})
export class VideoSuggestionsModule {}
