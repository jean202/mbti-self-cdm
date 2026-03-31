import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IdeaStatus,
  Prisma,
  TaskStatus,
  TodayFocusStatus,
} from '@prisma/client';

import {
  formatLocalDate,
  parseLocalDate,
  resolveRequestedLocalDate,
} from '../../common/utils/local-date.util';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { TypeProfileLoaderService } from '../type-profiles/type-profile-loader.service';
import { CreateMoodEnergyCheckDto } from './dto/create-mood-energy-check.dto';
import { UpsertReflectionDto } from './dto/upsert-reflection.dto';

interface TypeProfileCopyLocale {
  review_prompt_labels?: Record<string, string>;
  recovery?: {
    card_title?: string;
    card_body?: string;
  };
}

interface TypeProfileDocument {
  copy?: Record<string, TypeProfileCopyLocale>;
  recovery_protocol?: {
    default_duration_minutes?: number;
  };
}

@Injectable()
export class ReflectService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly typeProfileLoaderService: TypeProfileLoaderService,
  ) {}

  async getDaily(userId: string, requestedLocalDate?: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        locale: true,
        timezone: true,
        mbtiProfile: {
          select: {
            typeCode: true,
            profileVersion: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User was not found.');
    }

    const localDate = resolveRequestedLocalDate(
      requestedLocalDate,
      user.timezone,
    );
    const localDateValue = parseLocalDate(localDate);

    const [todayFocus, tasks, moodEnergyCheck, reflection] =
      await Promise.all([
        this.prismaService.todayFocus.findFirst({
          where: {
            userId,
            localDate: localDateValue,
            status: TodayFocusStatus.ACTIVE,
          },
          select: {
            id: true,
            localDate: true,
            title: true,
            status: true,
          },
        }),
        this.prismaService.task.findMany({
          where: {
            userId,
            localDueDate: localDateValue,
            status: { not: TaskStatus.ARCHIVED },
          },
          select: { status: true },
        }),
        this.prismaService.moodEnergyCheck.findFirst({
          where: {
            userId,
            localDate: localDateValue,
            context: 'EVENING',
          },
          select: {
            id: true,
            moodScore: true,
            energyScore: true,
            context: true,
          },
        }),
        this.prismaService.reflection.findUnique({
          where: {
            userId_localDate: {
              userId,
              localDate: localDateValue,
            },
          },
          select: {
            id: true,
            submittedAt: true,
          },
        }),
      ]);

    const completedCount = tasks.filter(
      (t) => t.status === TaskStatus.DONE,
    ).length;
    const incompleteCount = tasks.length - completedCount;

    // Load type-profile for reflection prompts and mindfulness recommendation
    let reflectionPrompts: Array<{ key: string; label: string }> = [];
    let mindfulnessRecommendation: {
      title: string;
      body: string;
      duration_minutes: number | null;
    } | null = null;

    if (user.mbtiProfile) {
      const profile = (await this.typeProfileLoaderService.getProfile(
        user.mbtiProfile.typeCode,
        user.mbtiProfile.profileVersion ?? undefined,
      )) as TypeProfileDocument | null;

      if (profile) {
        const locale = user.locale ?? 'ko-KR';
        const copy = profile.copy?.[locale] ?? profile.copy?.['ko-KR'];

        if (copy?.review_prompt_labels) {
          reflectionPrompts = Object.entries(copy.review_prompt_labels).map(
            ([key, label]) => ({ key, label }),
          );
        }

        if (copy?.recovery) {
          mindfulnessRecommendation = {
            title: copy.recovery.card_title ?? '',
            body: copy.recovery.card_body ?? '',
            duration_minutes:
              profile.recovery_protocol?.default_duration_minutes ?? null,
          };
        }
      }
    }

    return {
      today_focus: todayFocus
        ? {
            id: todayFocus.id,
            local_date: formatLocalDate(todayFocus.localDate),
            title: todayFocus.title,
            status: todayFocus.status,
          }
        : null,
      task_summary: {
        completed_count: completedCount,
        incomplete_count: incompleteCount,
      },
      mood_energy_check: moodEnergyCheck
        ? {
            id: moodEnergyCheck.id,
            mood_score: moodEnergyCheck.moodScore,
            energy_score: moodEnergyCheck.energyScore,
            context: moodEnergyCheck.context,
          }
        : null,
      reflection_prompts: reflectionPrompts,
      mindfulness_recommendation: mindfulnessRecommendation,
      existing_reflection_id: reflection?.id ?? null,
      already_submitted: !!reflection?.submittedAt,
    };
  }

  async createMoodEnergyCheck(
    userId: string,
    input: CreateMoodEnergyCheckDto,
  ) {
    const localDateValue = parseLocalDate(input.local_date);

    const existing = await this.prismaService.moodEnergyCheck.findUnique({
      where: {
        userId_localDate_context: {
          userId,
          localDate: localDateValue,
          context: input.context,
        },
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        'Mood-energy check already exists for this date and context.',
      );
    }

    const check = await this.prismaService.moodEnergyCheck.create({
      data: {
        userId,
        localDate: localDateValue,
        context: input.context,
        moodScore: input.mood_score,
        energyScore: input.energy_score,
        note: input.note ?? null,
      },
    });

    return {
      id: check.id,
      local_date: formatLocalDate(check.localDate),
      context: check.context,
      mood_score: check.moodScore,
      energy_score: check.energyScore,
      note: check.note,
      created_at: check.createdAt.toISOString(),
    };
  }

  async upsertReflection(
    userId: string,
    localDate: string,
    input: UpsertReflectionDto,
  ) {
    const localDateValue = parseLocalDate(localDate);

    if (input.today_focus_id) {
      const focus = await this.prismaService.todayFocus.findFirst({
        where: { id: input.today_focus_id, userId },
        select: { id: true },
      });

      if (!focus) {
        throw new NotFoundException('Today focus was not found.');
      }
    }

    if (input.mood_energy_check_id) {
      const check = await this.prismaService.moodEnergyCheck.findFirst({
        where: { id: input.mood_energy_check_id, userId },
        select: { id: true },
      });

      if (!check) {
        throw new NotFoundException('Mood-energy check was not found.');
      }
    }

    const reflection = await this.prismaService.reflection.upsert({
      where: {
        userId_localDate: {
          userId,
          localDate: localDateValue,
        },
      },
      create: {
        userId,
        localDate: localDateValue,
        todayFocusId: input.today_focus_id ?? null,
        moodEnergyCheckId: input.mood_energy_check_id ?? null,
        mindfulnessPromptId: input.mindfulness_prompt_id ?? null,
        completedSummary: input.completed_summary ?? null,
        carryForwardNote: input.carry_forward_note ?? null,
        promptAnswersJson: input.prompt_answers ?? Prisma.JsonNull,
        submittedAt: new Date(),
      },
      update: {
        todayFocusId:
          input.today_focus_id === undefined
            ? undefined
            : input.today_focus_id ?? null,
        moodEnergyCheckId:
          input.mood_energy_check_id === undefined
            ? undefined
            : input.mood_energy_check_id ?? null,
        mindfulnessPromptId:
          input.mindfulness_prompt_id === undefined
            ? undefined
            : input.mindfulness_prompt_id ?? null,
        completedSummary:
          input.completed_summary === undefined
            ? undefined
            : input.completed_summary ?? null,
        carryForwardNote:
          input.carry_forward_note === undefined
            ? undefined
            : input.carry_forward_note ?? null,
        promptAnswersJson:
          input.prompt_answers === undefined
            ? undefined
            : input.prompt_answers ?? Prisma.JsonNull,
        submittedAt: new Date(),
      },
    });

    return {
      id: reflection.id,
      local_date: formatLocalDate(reflection.localDate),
      submitted_at: reflection.submittedAt?.toISOString() ?? null,
    };
  }
}
