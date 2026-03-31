import { Module } from '@nestjs/common';

import { MbtiController } from './mbti.controller';
import { MbtiService } from './mbti.service';

@Module({
  controllers: [MbtiController],
  providers: [MbtiService],
})
export class MbtiModule {}
