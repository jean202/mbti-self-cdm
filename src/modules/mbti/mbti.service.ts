import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MbtiSource, OnboardingStatus } from '@prisma/client';

import { toMbtiProfileSummary } from '../../common/utils/mbti-profile-summary.util';
import { toOnboardingState } from '../../common/utils/onboarding-state.util';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { TypeProfileLoaderService } from '../type-profiles/type-profile-loader.service';
import { ConfirmMbtiProfileDto } from './dto/confirm-mbti-profile.dto';

interface TypeProfileManifest {
  profile_version?: string;
  default_locale?: string;
  available_types?: unknown;
}

interface TypeProfileCopyLocale {
  type_title?: string;
  type_summary?: string;
}

interface TypeProfileDocument {
  type_code?: string;
  differentiation?: {
    core_driver?: string;
  };
  cognitive_stack?: {
    dominant?: string;
    auxiliary?: string;
    tertiary?: string;
    inferior?: string;
  };
  copy?: Record<string, TypeProfileCopyLocale>;
}

@Injectable()
export class MbtiService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly typeProfileLoaderService: TypeProfileLoaderService,
  ) {}

  async getTypeCatalog(userId: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: {
        locale: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User was not found.');
    }

    const manifest =
      (await this.typeProfileLoaderService.getManifest()) as TypeProfileManifest;
    const profileVersion = this.readProfileVersion(manifest);
    const defaultLocale = this.readDefaultLocale(manifest);
    const availableTypes = this.readAvailableTypes(manifest);
    const profiles = await Promise.all(
      availableTypes.map((typeCode) =>
        this.typeProfileLoaderService.getProfile(typeCode, profileVersion),
      ),
    );

    return profiles.map((profileValue, index) => {
      const profile = profileValue as TypeProfileDocument;
      const copy = this.pickLocaleCopy(profile.copy, user.locale, defaultLocale);
      const typeCode = profile.type_code ?? availableTypes[index];

      return {
        type_code: typeCode,
        title: copy?.type_title ?? typeCode,
        summary: copy?.type_summary ?? profile.differentiation?.core_driver ?? '',
        cognitive_stack: this.toCognitiveStackArray(profile),
      };
    });
  }

  async confirmProfile(userId: string, input: ConfirmMbtiProfileDto) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: {
        onboardingStatus: true,
        mbtiProfile: {
          select: {
            typeCode: true,
            source: true,
            confidenceScore: true,
            finderVersion: true,
            profileVersion: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User was not found.');
    }

    const manifest =
      (await this.typeProfileLoaderService.getManifest()) as TypeProfileManifest;
    const availableTypes = this.readAvailableTypes(manifest);

    if (!availableTypes.includes(input.type_code)) {
      throw new BadRequestException('Unsupported MBTI type code.');
    }

    const now = new Date();
    const nextOnboardingStatus =
      user.onboardingStatus === OnboardingStatus.COMPLETED
        ? OnboardingStatus.COMPLETED
        : OnboardingStatus.CALENDAR_PENDING;
    const shouldReuseFinderResult =
      input.source === MbtiSource.FINDER_RESULT &&
      user.mbtiProfile?.source === MbtiSource.FINDER_RESULT &&
      user.mbtiProfile.typeCode === input.type_code;
    const profileVersion = shouldReuseFinderResult
      ? user.mbtiProfile?.profileVersion ?? this.readProfileVersion(manifest)
      : this.readProfileVersion(manifest);

    const mbtiProfile = await this.prismaService.$transaction(async (tx) => {
      const updatedProfile = await tx.mbtiProfile.upsert({
        where: {
          userId,
        },
        create: {
          userId,
          typeCode: input.type_code,
          source: input.source,
          isUserConfirmed: true,
          confidenceScore: shouldReuseFinderResult
            ? user.mbtiProfile?.confidenceScore ?? null
            : null,
          finderVersion: shouldReuseFinderResult
            ? user.mbtiProfile?.finderVersion ?? null
            : null,
          profileVersion,
          lastChangedAt: now,
        },
        update: {
          typeCode: input.type_code,
          source: input.source,
          isUserConfirmed: true,
          confidenceScore: shouldReuseFinderResult
            ? user.mbtiProfile?.confidenceScore ?? null
            : null,
          finderVersion: shouldReuseFinderResult
            ? user.mbtiProfile?.finderVersion ?? null
            : null,
          profileVersion,
          lastChangedAt: now,
        },
      });

      await tx.user.update({
        where: {
          id: userId,
        },
        data: {
          onboardingStatus: nextOnboardingStatus,
          lastActiveAt: now,
        },
      });

      return updatedProfile;
    });

    return {
      mbti_profile: toMbtiProfileSummary(mbtiProfile),
      onboarding: toOnboardingState(nextOnboardingStatus),
    };
  }

  private readProfileVersion(manifest: TypeProfileManifest): string | undefined {
    return typeof manifest.profile_version === 'string'
      ? manifest.profile_version
      : undefined;
  }

  private readDefaultLocale(manifest: TypeProfileManifest): string {
    return typeof manifest.default_locale === 'string'
      ? manifest.default_locale
      : 'ko-KR';
  }

  private readAvailableTypes(manifest: TypeProfileManifest): string[] {
    const { available_types } = manifest;

    if (!Array.isArray(available_types)) {
      throw new NotFoundException('Type profile catalog was not found.');
    }

    return available_types
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toUpperCase());
  }

  private pickLocaleCopy(
    copyMap: Record<string, TypeProfileCopyLocale> | undefined,
    locale: string,
    defaultLocale: string,
  ): TypeProfileCopyLocale | undefined {
    if (!copyMap) {
      return undefined;
    }

    return copyMap[locale] ?? copyMap[defaultLocale] ?? Object.values(copyMap)[0];
  }

  private toCognitiveStackArray(profile: TypeProfileDocument): string[] {
    const stack = profile.cognitive_stack;

    if (!stack) {
      return [];
    }

    return [
      stack.dominant,
      stack.auxiliary,
      stack.tertiary,
      stack.inferior,
    ].filter((value): value is string => typeof value === 'string');
  }
}
