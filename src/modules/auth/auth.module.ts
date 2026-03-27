import { Global, Module } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard';
import { SessionModule } from '../session/session.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ProviderVerificationService } from './provider-verification.service';

@Global()
@Module({
  imports: [SessionModule],
  controllers: [AuthController],
  providers: [AuthGuard, AuthService, ProviderVerificationService],
  exports: [AuthGuard, AuthService, ProviderVerificationService],
})
export class AuthModule {}
