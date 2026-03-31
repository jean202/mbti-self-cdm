import { Injectable, NotFoundException } from '@nestjs/common';
import { CalendarConnectionStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../infra/prisma/prisma.service';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

@Injectable()
export class MeService {
  constructor(private readonly prismaService: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        primaryEmail: true,
        locale: true,
        timezone: true,
        onboardingStatus: true,
        notificationPrefsJson: true,
        mbtiProfile: {
          select: {
            typeCode: true,
            source: true,
            isUserConfirmed: true,
            confidenceScore: true,
            profileVersion: true,
          },
        },
        calendarConnections: {
          where: {
            status: {
              not: CalendarConnectionStatus.REVOKED,
            },
          },
          select: {
            id: true,
            provider: true,
            accountLabel: true,
            status: true,
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
        notification_prefs: user.notificationPrefsJson ?? null,
      },
      mbti_profile: user.mbtiProfile
        ? {
            type_code: user.mbtiProfile.typeCode,
            source: user.mbtiProfile.source,
            is_user_confirmed: user.mbtiProfile.isUserConfirmed,
            confidence_score: user.mbtiProfile.confidenceScore
              ? Number(user.mbtiProfile.confidenceScore)
              : null,
            profile_version: user.mbtiProfile.profileVersion,
          }
        : null,
      calendar_connections: user.calendarConnections.map((c) => ({
        id: c.id,
        provider: c.provider,
        account_label: c.accountLabel,
        status: c.status,
      })),
    };
  }

  async updatePreferences(userId: string, input: UpdatePreferencesDto) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { id: true, notificationPrefsJson: true },
    });

    if (!user) {
      throw new NotFoundException('User was not found.');
    }

    const data: Prisma.UserUpdateInput = {};

    if (input.locale !== undefined) {
      data.locale = input.locale;
    }

    if (input.timezone !== undefined) {
      data.timezone = input.timezone;
    }

    if (input.notification_prefs !== undefined) {
      // Merge with existing prefs
      const currentPrefs =
        (user.notificationPrefsJson as Record<string, unknown>) ?? {};
      const merged = {
        ...currentPrefs,
        ...JSON.parse(JSON.stringify(input.notification_prefs)),
      };
      data.notificationPrefsJson = merged as Prisma.InputJsonValue;
    }

    const updated = await this.prismaService.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        locale: true,
        timezone: true,
        notificationPrefsJson: true,
      },
    });

    return {
      locale: updated.locale,
      timezone: updated.timezone,
      notification_prefs: updated.notificationPrefsJson ?? null,
    };
  }
}
