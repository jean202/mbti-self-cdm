import { Module } from '@nestjs/common';

import { TypeProfilesModule } from '../type-profiles/type-profiles.module';
import { MbtiController } from './mbti.controller';
import { MbtiFinderQuestionSetService } from './mbti-finder-question-set.service';
import { MbtiFinderScoringService } from './mbti-finder-scoring.service';
import { MbtiService } from './mbti.service';

@Module({
  imports: [TypeProfilesModule],
  controllers: [MbtiController],
  providers: [
    MbtiService,
    MbtiFinderQuestionSetService,
    MbtiFinderScoringService,
  ],
})
export class MbtiModule {}
