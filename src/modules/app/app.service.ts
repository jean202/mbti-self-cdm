import { Injectable, NotFoundException } from '@nestjs/common';
import { CalendarConnectionStatus } from '@prisma/client';

import { toMbtiProfileSummary } from '../../common/utils/mbti-profile-summary.util';
import { toOnboardingState } from '../../common/utils/onboarding-state.util';
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
      onboarding: toOnboardingState(user.onboardingStatus),
      mbti_profile: user.mbtiProfile
        ? toMbtiProfileSummary(user.mbtiProfile)
        : null,
      has_calendar_connection: user.calendarConnections.length > 0,
    };
  }
}
