import { Module } from '@nestjs/common';

import { HomeController } from './home.controller';
import { HomeService } from './home.service';
import { TodayFocusController } from './today-focus.controller';
import { VideoSuggestionsModule } from '../video-suggestions/video-suggestions.module';

@Module({
  imports: [VideoSuggestionsModule],
  controllers: [HomeController, TodayFocusController],
  providers: [HomeService],
})
export class HomeModule {}
