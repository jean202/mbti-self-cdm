import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user.type';
import { AnalyzeCaptureDto } from './dto/analyze-capture.dto';
import { CaptureService } from './capture.service';

@Controller('capture')
@UseGuards(AuthGuard)
export class CaptureController {
  constructor(private readonly captureService: CaptureService) {}

  @Post('analyze')
  analyze(
    @CurrentUser() currentUser: RequestUser,
    @Body() body: AnalyzeCaptureDto,
  ) {
    return this.captureService.analyze(currentUser.userId, body);
  }
}
