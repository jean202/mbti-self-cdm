import { Injectable } from '@nestjs/common';
import {
  AuthIdentity,
  OnboardingStatus,
  type User,
  Prisma,
} from '@prisma/client';

import { toOnboardingState } from '../../common/utils/onboarding-state.util';
import type { RequestUser } from '../../common/types/request-user.type';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SessionService } from '../session/session.service';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ProviderVerificationService } from './provider-verification.service';
import { SocialLoginDto } from './dto/social-login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly sessionService: SessionService,
    private readonly providerVerificationService: ProviderVerificationService,
  ) {}

  async socialLogin(input: SocialLoginDto) {
    const verifiedIdentity = await this.providerVerificationService.verify(input);
    const authIdentity = await this.prismaService.authIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: verifiedIdentity.provider,
          providerUserId: verifiedIdentity.providerUserId,
        },
      },
      include: {
        user: true,
      },
    });
    const now = new Date();
    const user = authIdentity
      ? await this.updateExistingIdentity(authIdentity, verifiedIdentity, now)
      : await this.createFirstIdentity(verifiedIdentity, now);

    const tokens = await this.sessionService.createSession({
      userId: user.id,
      deviceId: input.device.device_id,
      platform: input.device.platform,
      appVersion: input.device.app_version,
    });

    return {
      tokens,
      user: this.toUserSummary(user),
      onboarding: toOnboardingState(user.onboardingStatus),
    };
  }

  async refresh(input: RefreshTokenDto) {
    const tokens = await this.sessionService.rotateRefreshToken({
      sessionId: input.session_id,
      refreshToken: input.refresh_token,
      deviceId: input.device_id,
    });

    return {
      tokens,
    };
  }

  async logout(currentUser: RequestUser, input: LogoutDto) {
    if (input.logout_all_devices) {
      await this.sessionService.revokeAllSessions(currentUser.userId);
    } else {
      await this.sessionService.revokeSession(
        currentUser.sessionId,
        currentUser.userId,
        input.refresh_token,
      );
    }

    return {
      success: true,
    };
  }

  private async updateExistingIdentity(
    authIdentity: AuthIdentity & { user: User },
    verifiedIdentity: {
      providerEmail?: string;
      providerDisplayName?: string;
      rawProfileJson: Record<string, unknown>;
    },
    now: Date,
  ): Promise<User> {
    const updated = await this.prismaService.$transaction(async (tx) => {
      await tx.authIdentity.update({
        where: { id: authIdentity.id },
        data: {
          providerEmail: verifiedIdentity.providerEmail ?? authIdentity.providerEmail,
          providerDisplayName:
            verifiedIdentity.providerDisplayName ??
            authIdentity.providerDisplayName,
          rawProfileJson:
            verifiedIdentity.rawProfileJson as Prisma.InputJsonValue,
          lastLoginAt: now,
        },
      });

      return tx.user.update({
        where: { id: authIdentity.userId },
        data: {
          displayName:
            authIdentity.user.displayName ??
            verifiedIdentity.providerDisplayName ??
            null,
          primaryEmail:
            authIdentity.user.primaryEmail ??
            verifiedIdentity.providerEmail ??
            null,
          lastActiveAt: now,
        },
      });
    });

    return updated;
  }

  private async createFirstIdentity(
    verifiedIdentity: {
      provider: AuthIdentity['provider'];
      providerUserId: string;
      providerEmail?: string;
      providerDisplayName?: string;
      rawProfileJson: Record<string, unknown>;
    },
    now: Date,
  ): Promise<User> {
    const created = await this.prismaService.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          displayName: verifiedIdentity.providerDisplayName ?? null,
          primaryEmail: verifiedIdentity.providerEmail ?? null,
          onboardingStatus: OnboardingStatus.MBTI_PENDING,
          lastActiveAt: now,
        },
      });

      await tx.authIdentity.create({
        data: {
          userId: user.id,
          provider: verifiedIdentity.provider,
          providerUserId: verifiedIdentity.providerUserId,
          providerEmail: verifiedIdentity.providerEmail ?? null,
          providerDisplayName: verifiedIdentity.providerDisplayName ?? null,
          rawProfileJson:
            verifiedIdentity.rawProfileJson as Prisma.InputJsonValue,
          linkedAt: now,
          lastLoginAt: now,
        },
      });

      return user;
    });

    return created;
  }

  private toUserSummary(
    user: Pick<
      User,
      | 'id'
      | 'displayName'
      | 'primaryEmail'
      | 'locale'
      | 'timezone'
      | 'onboardingStatus'
    >,
  ) {
    return {
      id: user.id,
      display_name: user.displayName,
      primary_email: user.primaryEmail,
      locale: user.locale,
      timezone: user.timezone,
      onboarding_status: user.onboardingStatus,
    };
  }
}
