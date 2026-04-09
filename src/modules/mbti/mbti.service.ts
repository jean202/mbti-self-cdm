import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FinderAttemptStatus,
  MbtiSource,
  OnboardingStatus,
  Prisma,
} from '@prisma/client';

import { toMbtiProfileSummary } from '../../common/utils/mbti-profile-summary.util';
import { toOnboardingState } from '../../common/utils/onboarding-state.util';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { TypeProfileLoaderService } from '../type-profiles/type-profile-loader.service';
import { ConfirmMbtiProfileDto } from './dto/confirm-mbti-profile.dto';
import { SelfSelectMbtiProfileDto } from './dto/self-select-mbti-profile.dto';
import { StartMbtiFinderAttemptDto } from './dto/start-mbti-finder-attempt.dto';
import { SubmitMbtiFinderAnswersDto } from './dto/submit-mbti-finder-answers.dto';
import { MbtiFinderQuestionSetService } from './mbti-finder-question-set.service';
import { MbtiFinderScoringService } from './mbti-finder-scoring.service';

interface TypeProfileManifest {
  profile_version?: string;
  default_locale?: string;
  available_types?: unknown;
}

interface TypeProfileCopyLocale {
  type_title?: string;
  type_summary?: string;
  onboarding?: {
    result_summary?: string;
    best_fit_confirmation_prompt?: string;
  };
  plan?: {
    today_prompt?: string;
  };
  capture?: {
    task_hint?: string;
  };
  review_prompt_labels?: Record<string, string>;
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
  task_capture_style?: {
    style_key?: string;
    prompt_mode?: string;
  };
  review_prompts?: Array<{
    key?: string;
    intent?: string;
  }>;
  copy?: Record<string, TypeProfileCopyLocale>;
}

@Injectable()
export class MbtiService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly typeProfileLoaderService: TypeProfileLoaderService,
    private readonly mbtiFinderQuestionSetService: MbtiFinderQuestionSetService,
    private readonly mbtiFinderScoringService: MbtiFinderScoringService,
  ) {}

  async getTypeCatalog(userId: string) {
    const user = await this.findUserOrThrow(userId, {
      locale: true,
    });
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

  async selfSelectProfile(userId: string, input: SelfSelectMbtiProfileDto) {
    const user = await this.findUserOrThrow(userId, {
      onboardingStatus: true,
    });
    const manifest =
      (await this.typeProfileLoaderService.getManifest()) as TypeProfileManifest;
    const availableTypes = this.readAvailableTypes(manifest);

    if (!availableTypes.includes(input.type_code)) {
      throw new BadRequestException('Unsupported MBTI type code.');
    }

    const now = new Date();
    const nextOnboardingStatus =
      user.onboardingStatus === OnboardingStatus.AUTH_ONLY
        ? OnboardingStatus.MBTI_PENDING
        : user.onboardingStatus;
    const mbtiProfile = await this.prismaService.$transaction(async (tx) => {
      const profile = await tx.mbtiProfile.upsert({
        where: {
          userId,
        },
        create: {
          userId,
          typeCode: input.type_code,
          source: MbtiSource.SELF_SELECTED,
          isUserConfirmed: false,
          confidenceScore: null,
          finderVersion: null,
          profileVersion: this.readProfileVersion(manifest),
          lastChangedAt: now,
        },
        update: {
          typeCode: input.type_code,
          source: MbtiSource.SELF_SELECTED,
          isUserConfirmed: false,
          confidenceScore: null,
          finderVersion: null,
          profileVersion: this.readProfileVersion(manifest),
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

      return profile;
    });

    return {
      mbti_profile: toMbtiProfileSummary(mbtiProfile),
      onboarding: this.toIntermediateOnboardingState(nextOnboardingStatus),
    };
  }

  async startFinderAttempt(
    userId: string,
    input: StartMbtiFinderAttemptDto,
  ) {
    await this.findUserOrThrow(userId, {
      id: true,
    });

    const questionSet = await this.mbtiFinderQuestionSetService.getQuestionSet(
      input.question_set_version,
    );
    const existingAttempt = await this.prismaService.mbtiFinderAttempt.findFirst({
      where: {
        userId,
        status: FinderAttemptStatus.IN_PROGRESS,
        questionSetVersion: questionSet.questionSetVersion,
      },
      include: {
        answers: {
          select: {
            id: true,
          },
        },
      },
      orderBy: {
        startedAt: 'desc',
      },
    });
    const now = new Date();
    const attempt =
      existingAttempt ??
      (await this.prismaService.mbtiFinderAttempt.create({
        data: {
          userId,
          status: FinderAttemptStatus.IN_PROGRESS,
          questionSetVersion: questionSet.questionSetVersion,
          startedAt: now,
        },
      }));

    await this.prismaService.user.update({
      where: {
        id: userId,
      },
      data: {
        lastActiveAt: now,
      },
    });

    return {
      attempt_id: attempt.id,
      status: attempt.status,
      question_set_version: attempt.questionSetVersion,
      questions: this.serializeFinderQuestions(questionSet),
      progress: {
        answered_count: existingAttempt?.answers.length ?? 0,
        total_count: questionSet.questions.length,
      },
    };
  }

  async getFinderAttempt(userId: string, attemptId: string) {
    const attempt = await this.findFinderAttemptOrThrow(userId, attemptId);
    const questionSet = await this.mbtiFinderQuestionSetService.getQuestionSet(
      attempt.questionSetVersion,
    );

    return {
      attempt_id: attempt.id,
      status: attempt.status,
      question_set_version: attempt.questionSetVersion,
      answers: attempt.answers.map((answer) => ({
        question_id: answer.questionId,
        answer_value: answer.answerValue,
      })),
      questions: this.serializeFinderQuestions(questionSet),
      progress: {
        answered_count: attempt.answers.length,
        total_count: questionSet.questions.length,
      },
    };
  }

  async submitFinderAnswers(
    userId: string,
    attemptId: string,
    input: SubmitMbtiFinderAnswersDto,
  ) {
    const attempt = await this.findFinderAttemptOrThrow(userId, attemptId);

    if (attempt.status !== FinderAttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('Finder attempt is not in progress.');
    }

    const questionSet = await this.mbtiFinderQuestionSetService.getQuestionSet(
      attempt.questionSetVersion,
    );
    const validQuestionIds = new Set(questionSet.questions.map((question) => question.id));
    const uniqueQuestionIds = new Set<string>();

    for (const answer of input.answers) {
      if (!validQuestionIds.has(answer.question_id)) {
        throw new BadRequestException(
          `Unknown finder question id: ${answer.question_id}`,
        );
      }

      if (uniqueQuestionIds.has(answer.question_id)) {
        throw new BadRequestException(
          `Duplicate finder answer for question id: ${answer.question_id}`,
        );
      }

      uniqueQuestionIds.add(answer.question_id);
    }

    const answeredCount = await this.prismaService.$transaction(async (tx) => {
      for (const answer of input.answers) {
        await tx.mbtiFinderAnswer.upsert({
          where: {
            attemptId_questionId: {
              attemptId,
              questionId: answer.question_id,
            },
          },
          create: {
            attemptId,
            questionId: answer.question_id,
            answerValue: answer.answer_value,
          },
          update: {
            answerValue: answer.answer_value,
            answeredAt: new Date(),
          },
        });
      }

      return tx.mbtiFinderAnswer.count({
        where: {
          attemptId,
        },
      });
    });

    return {
      attempt_id: attempt.id,
      progress: {
        answered_count: answeredCount,
        total_count: questionSet.questions.length,
      },
    };
  }

  async completeFinderAttempt(userId: string, attemptId: string) {
    const [user, attempt] = await Promise.all([
      this.findUserOrThrow(userId, {
        onboardingStatus: true,
        locale: true,
      }),
      this.findFinderAttemptOrThrow(userId, attemptId),
    ]);
    const questionSet = await this.mbtiFinderQuestionSetService.getQuestionSet(
      attempt.questionSetVersion,
    );
    const answeredQuestionIds = new Set(
      attempt.answers.map((answer) => answer.questionId),
    );

    if (
      attempt.status === FinderAttemptStatus.IN_PROGRESS &&
      answeredQuestionIds.size !== questionSet.questions.length
    ) {
      throw new BadRequestException(
        'All finder questions must be answered before completion.',
      );
    }

    if (
      attempt.status !== FinderAttemptStatus.IN_PROGRESS &&
      attempt.status !== FinderAttemptStatus.COMPLETED
    ) {
      throw new BadRequestException('Finder attempt cannot be completed.');
    }

    const score = this.mbtiFinderScoringService.scoreAttempt(
      questionSet,
      attempt.answers.map((answer) => ({
        questionId: answer.questionId,
        answerValue: answer.answerValue,
      })),
    );
    const manifest =
      (await this.typeProfileLoaderService.getManifest()) as TypeProfileManifest;
    const profileVersion = this.readProfileVersion(manifest);

    if (attempt.status === FinderAttemptStatus.IN_PROGRESS) {
      const now = new Date();

      await this.prismaService.$transaction(async (tx) => {
        await tx.mbtiFinderAttempt.update({
          where: {
            id: attempt.id,
          },
          data: {
            status: FinderAttemptStatus.COMPLETED,
            predictedTypeCode: score.predictedTypeCode,
            confidenceScore: new Prisma.Decimal(score.confidenceScore.toFixed(4)),
            completedAt: now,
            abandonedAt: null,
          },
        });

        await tx.mbtiProfile.upsert({
          where: {
            userId,
          },
          create: {
            userId,
            typeCode: score.predictedTypeCode,
            source: MbtiSource.FINDER_RESULT,
            isUserConfirmed: false,
            confidenceScore: new Prisma.Decimal(score.confidenceScore.toFixed(4)),
            finderVersion: questionSet.questionSetVersion,
            profileVersion,
            lastChangedAt: now,
          },
          update: {
            typeCode: score.predictedTypeCode,
            source: MbtiSource.FINDER_RESULT,
            isUserConfirmed: false,
            confidenceScore: new Prisma.Decimal(score.confidenceScore.toFixed(4)),
            finderVersion: questionSet.questionSetVersion,
            profileVersion,
            lastChangedAt: now,
          },
        });

        await tx.user.update({
          where: {
            id: userId,
          },
          data: {
            onboardingStatus:
              user.onboardingStatus === OnboardingStatus.AUTH_ONLY
                ? OnboardingStatus.MBTI_PENDING
                : user.onboardingStatus,
            lastActiveAt: now,
          },
        });
      });
    }

    return {
      attempt_id: attempt.id,
      predicted_type_code: score.predictedTypeCode,
      confidence_score: score.confidenceScore,
      alternative_types: score.alternativeTypes,
      result_summary: await this.buildFinderResultSummary(
        user.locale,
        score.predictedTypeCode,
        profileVersion,
      ),
      onboarding: this.toIntermediateOnboardingState(user.onboardingStatus),
    };
  }

  async confirmProfile(userId: string, input: ConfirmMbtiProfileDto) {
    const user = await this.findUserOrThrow(userId, {
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
    });
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

  private async buildFinderResultSummary(
    locale: string,
    typeCode: string,
    profileVersion: string | undefined,
  ) {
    const profile = (await this.typeProfileLoaderService.getProfile(
      typeCode,
      profileVersion,
    )) as TypeProfileDocument;
    const copy = this.pickLocaleCopy(profile.copy, locale, 'ko-KR');
    const reflectionLabel = copy?.review_prompt_labels
      ? Object.values(copy.review_prompt_labels)[0]
      : undefined;

    return {
      cognitive_stack: this.toCognitiveStackArray(profile),
      planning_summary:
        copy?.plan?.today_prompt ??
        copy?.onboarding?.result_summary ??
        profile.differentiation?.core_driver ??
        null,
      capture_summary:
        copy?.capture?.task_hint ??
        profile.task_capture_style?.prompt_mode ??
        null,
      reflection_summary:
        reflectionLabel ?? profile.review_prompts?.[0]?.intent ?? null,
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

  private serializeFinderQuestions(questionSet: {
    scale: number[];
    questions: Array<{
      id: string;
      prompt: string;
      order: number;
    }>;
  }) {
    return questionSet.questions.map((question) => ({
      question_id: question.id,
      prompt: question.prompt,
      scale: questionSet.scale,
      order: question.order,
    }));
  }

  private async findFinderAttemptOrThrow(
    userId: string,
    attemptId: string,
  ) {
    const attempt = await this.prismaService.mbtiFinderAttempt.findFirst({
      where: {
        id: attemptId,
        userId,
      },
      include: {
        answers: {
          orderBy: {
            questionId: 'asc',
          },
        },
      },
    });

    if (!attempt) {
      throw new NotFoundException('MBTI finder attempt was not found.');
    }

    return attempt;
  }

  private async findUserOrThrow<TSelect extends Prisma.UserSelect>(
    userId: string,
    select: TSelect,
  ): Promise<Prisma.UserGetPayload<{ select: TSelect }>> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select,
    });

    if (!user) {
      throw new NotFoundException('User was not found.');
    }

    return user;
  }

  private toIntermediateOnboardingState(status: OnboardingStatus) {
    if (
      status === OnboardingStatus.AUTH_ONLY ||
      status === OnboardingStatus.MBTI_PENDING
    ) {
      return {
        status: OnboardingStatus.MBTI_PENDING,
        next_step: 'MBTI_CONFIRMATION' as const,
        is_completed: false,
      };
    }

    return toOnboardingState(status);
  }
}
