import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CalendarConnectionStatus,
  OnboardingStatus,
  type MbtiProfile,
} from '@prisma/client';

import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private readonly prismaService: PrismaService) {}

  async getBootstrap(userId: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        primaryEmail: true,
        locale: true,
        timezone: true,
        onboardingStatus: true,
        mbtiProfile: true,
        calendarConnections: {
          where: {
            status: {
              in: [
                CalendarConnectionStatus.ACTIVE,
                CalendarConnectionStatus.SYNCING,
              ],
            },
          },
          select: {
            id: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User was not found.');
    }

    return {
      user: {
        id: user.id,
        display_name: user.displayName,
        primary_email: user.primaryEmail,
        locale: user.locale,
        timezone: user.timezone,
        onboarding_status: user.onboardingStatus,
      },
      onboarding: this.toOnboardingState(user.onboardingStatus),
      mbti_profile: user.mbtiProfile
        ? this.toMbtiProfileSummary(user.mbtiProfile)
        : null,
      has_calendar_connection: user.calendarConnections.length > 0,
    };
  }

  private toOnboardingState(status: OnboardingStatus) {
    switch (status) {
      case OnboardingStatus.AUTH_ONLY:
      case OnboardingStatus.MBTI_PENDING:
        return {
          status,
          next_step: 'MBTI_ENTRY',
          is_completed: false,
        };
      case OnboardingStatus.CALENDAR_PENDING:
        return {
          status,
          next_step: 'CALENDAR_CONNECT',
          is_completed: false,
        };
      case OnboardingStatus.COMPLETED:
        return {
          status,
          next_step: 'HOME',
          is_completed: true,
        };
    }
  }

  private toMbtiProfileSummary(profile: MbtiProfile) {
    return {
      type_code: profile.typeCode,
      source: profile.source,
      is_user_confirmed: profile.isUserConfirmed,
      confidence_score: profile.confidenceScore
        ? Number(profile.confidenceScore)
        : null,
      profile_version: profile.profileVersion,
    };
  }
}
