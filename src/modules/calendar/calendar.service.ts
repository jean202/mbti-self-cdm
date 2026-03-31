import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnboardingStatus } from '@prisma/client';

import { toOnboardingState } from '../../common/utils/onboarding-state.util';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class CalendarService {
  constructor(private readonly prismaService: PrismaService) {}

  async getConnections(userId: string) {
    await this.ensureUserExists(userId);

    const connections = await this.prismaService.calendarConnection.findMany({
      where: {
        userId,
      },
      orderBy: [{ connectedAt: 'desc' }],
      select: {
        id: true,
        provider: true,
        accountLabel: true,
        status: true,
        lastSyncedAt: true,
      },
    });

    return connections.map((connection) => ({
      id: connection.id,
      provider: connection.provider,
      account_label: connection.accountLabel,
      status: connection.status,
      last_synced_at: connection.lastSyncedAt?.toISOString() ?? null,
    }));
  }

  async skipCalendarOnboarding(userId: string) {
    const user = await this.prismaService.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        onboardingStatus: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User was not found.');
    }

    if (
      user.onboardingStatus === OnboardingStatus.AUTH_ONLY ||
      user.onboardingStatus === OnboardingStatus.MBTI_PENDING
    ) {
      throw new ConflictException(
        'Calendar onboarding cannot be skipped before MBTI is confirmed.',
      );
    }

    const now = new Date();

    await this.prismaService.user.update({
      where: {
        id: userId,
      },
      data: {
        onboardingStatus: OnboardingStatus.COMPLETED,
        lastActiveAt: now,
      },
    });

    return {
      onboarding: toOnboardingState(OnboardingStatus.COMPLETED),
    };
  }

  private async ensureUserExists(userId: string) {
    const user = await this.prismaService.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User was not found.');
    }
  }
}
