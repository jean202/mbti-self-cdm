import { Global, Module } from '@nestjs/common';

import { AuthTokenService } from '../auth/auth-token.service';
import { SessionService } from './session.service';

@Global()
@Module({
  providers: [AuthTokenService, SessionService],
  exports: [AuthTokenService, SessionService],
})
export class SessionModule {}
