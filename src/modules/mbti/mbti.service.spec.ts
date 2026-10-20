import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FinderAttemptStatus,
  MbtiSource,
  OnboardingStatus,
  Prisma,
} from '@prisma/client';

import type { PrismaService } from '../../infra/prisma/prisma.service';
import { TypeProfileLoaderService } from '../type-profiles/type-profile-loader.service';
import { MbtiFinderQuestionSetService } from './mbti-finder-question-set.service';
import { MbtiFinderScoringService } from './mbti-finder-scoring.service';
import { MbtiService } from './mbti.service';

const config = { get: jest.fn() } as unknown as ConfigService;
const questionSets = new MbtiFinderQuestionSetService(config);

function createHarness(
  user: Record<string, unknown> | null = {
    id: 'user-1',
    locale: 'ko-KR',
    onboardingStatus: OnboardingStatus.MBTI_PENDING,
    mbtiProfile: null,
  },
) {
  const tx = {
    mbtiProfile: {
      upsert: jest.fn().mockImplementation(({ create }) => ({ ...create })),
    },
    mbtiFinderAttempt: { update: jest.fn() },
    mbtiFinderAnswer: {
      upsert: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    user: { update: jest.fn() },
  };
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      update: jest.fn(),
    },
    mbtiFinderAttempt: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => ({
        id: 'attempt-new',
        ...data,
      })),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const service = new MbtiService(
    prisma as unknown as PrismaService,
    new TypeProfileLoaderService(config),
    questionSets,
    new MbtiFinderScoringService(),
  );

  return { service, prisma, tx };
}

async function answersFor(typeCode: string) {
  const { questions } = await questionSets.getQuestionSet('2026-03-v1');
  const positive = { EI: 'E', SN: 'S', TF: 'T', JP: 'J' } as const;
  const index = { EI: 0, SN: 1, TF: 2, JP: 3 } as const;

  return questions.map((question) => {
    const wantsPositive = typeCode[index[question.axis]] === positive[question.axis];

    return {
      id: `answer-${question.id}`,
      questionId: question.id,
      answerValue: wantsPositive === (question.direction === 1) ? 5 : 1,
    };
  });
}

describe('MbtiService', () => {
  describe('getTypeCatalog', () => {
    it('returns every type with localized copy and its cognitive stack', async () => {
      const { service } = createHarness();

      const catalog = await service.getTypeCatalog('user-1');

      expect(catalog).toHaveLength(16);
      expect(catalog.find((item) => item.type_code === 'INTJ')).toEqual({
        type_code: 'INTJ',
        title: expect.any(String),
        summary: expect.any(String),
        cognitive_stack: ['Ni', 'Te', 'Fi', 'Se'],
      });
    });

    it('falls back to the default locale copy for unsupported locales', async () => {
      const korean = await createHarness().service.getTypeCatalog('user-1');
      const fallback = await createHarness({
        id: 'user-1',
        locale: 'fr-FR',
      }).service.getTypeCatalog('user-1');

      expect(fallback).toEqual(korean);
    });

    it('throws when the user does not exist', async () => {
      await expect(
        createHarness(null).service.getTypeCatalog('ghost'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('selfSelectProfile', () => {
    it('stores an unconfirmed self-selected profile and moves AUTH_ONLY to MBTI_PENDING', async () => {
      const { service, tx } = createHarness({
        id: 'user-1',
        onboardingStatus: OnboardingStatus.AUTH_ONLY,
      });

      const result = await service.selfSelectProfile('user-1', { type_code: 'ISFP' });

      expect(tx.mbtiProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            typeCode: 'ISFP',
            source: MbtiSource.SELF_SELECTED,
            isUserConfirmed: false,
            profileVersion: '2026-03-v1',
          }),
        }),
      );
      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStatus: OnboardingStatus.MBTI_PENDING,
          }),
        }),
      );
      expect(result.onboarding).toEqual({
        status: OnboardingStatus.MBTI_PENDING,
        next_step: 'MBTI_CONFIRMATION',
        is_completed: false,
      });
    });

    it('does not move a completed user back into onboarding', async () => {
      const { service, tx } = createHarness({
        id: 'user-1',
        onboardingStatus: OnboardingStatus.COMPLETED,
      });

      const result = await service.selfSelectProfile('user-1', { type_code: 'ISFP' });

      expect(tx.user.update.mock.calls[0][0].data.onboardingStatus).toBe(
        OnboardingStatus.COMPLETED,
      );
      expect(result.onboarding.status).toBe(OnboardingStatus.COMPLETED);
    });

    it('rejects a type code that is not in the catalog', async () => {
      const { service, tx } = createHarness();

      await expect(
        service.selfSelectProfile('user-1', { type_code: 'XXXX' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.mbtiProfile.upsert).not.toHaveBeenCalled();
    });
  });

  describe('startFinderAttempt', () => {
    it('creates a new attempt on the latest question set', async () => {
      const { service, prisma } = createHarness();

      const result = await service.startFinderAttempt('user-1', {});

      expect(prisma.mbtiFinderAttempt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          status: FinderAttemptStatus.IN_PROGRESS,
          questionSetVersion: '2026-03-v1',
        }),
      });
      expect(result.attempt_id).toBe('attempt-new');
      expect(result.progress).toEqual({ answered_count: 0, total_count: 28 });
      expect(result.questions[0]).toEqual({
        question_id: 'q1',
        prompt: expect.any(String),
        scale: [1, 2, 3, 4, 5],
        order: 1,
      });
    });

    it('resumes an in-progress attempt with its progress', async () => {
      const { service, prisma } = createHarness();
      prisma.mbtiFinderAttempt.findFirst.mockResolvedValue({
        id: 'attempt-existing',
        status: FinderAttemptStatus.IN_PROGRESS,
        questionSetVersion: '2026-03-v1',
        answers: [{ id: 'a1' }, { id: 'a2' }],
      });

      const result = await service.startFinderAttempt('user-1', {});

      expect(prisma.mbtiFinderAttempt.create).not.toHaveBeenCalled();
      expect(result.attempt_id).toBe('attempt-existing');
      expect(result.progress.answered_count).toBe(2);
    });
  });

  describe('submitFinderAnswers', () => {
    function withAttempt(status: FinderAttemptStatus = FinderAttemptStatus.IN_PROGRESS) {
      const harness = createHarness();
      harness.prisma.mbtiFinderAttempt.findFirst.mockResolvedValue({
        id: 'attempt-1',
        status,
        questionSetVersion: '2026-03-v1',
        answers: [],
      });

      return harness;
    }

    it('upserts each answer and reports the stored count', async () => {
      const { service, tx } = withAttempt();
      tx.mbtiFinderAnswer.count.mockResolvedValue(2);

      const result = await service.submitFinderAnswers('user-1', 'attempt-1', {
        answers: [
          { question_id: 'q1', answer_value: 4 },
          { question_id: 'q2', answer_value: 2 },
        ],
      });

      expect(tx.mbtiFinderAnswer.upsert).toHaveBeenCalledTimes(2);
      expect(tx.mbtiFinderAnswer.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { attemptId_questionId: { attemptId: 'attempt-1', questionId: 'q1' } },
          create: { attemptId: 'attempt-1', questionId: 'q1', answerValue: 4 },
        }),
      );
      expect(result.progress).toEqual({ answered_count: 2, total_count: 28 });
    });

    it('validates every answer before writing any of them', async () => {
      const { service, tx } = withAttempt();

      await expect(
        service.submitFinderAnswers('user-1', 'attempt-1', {
          answers: [
            { question_id: 'q1', answer_value: 4 },
            { question_id: 'q999', answer_value: 4 },
          ],
        }),
      ).rejects.toThrow('Unknown finder question id: q999');
      await expect(
        service.submitFinderAnswers('user-1', 'attempt-1', {
          answers: [
            { question_id: 'q1', answer_value: 4 },
            { question_id: 'q1', answer_value: 5 },
          ],
        }),
      ).rejects.toThrow('Duplicate finder answer for question id: q1');
      expect(tx.mbtiFinderAnswer.upsert).not.toHaveBeenCalled();
    });

    it('refuses answers for a finished attempt', async () => {
      const { service } = withAttempt(FinderAttemptStatus.COMPLETED);

      await expect(
        service.submitFinderAnswers('user-1', 'attempt-1', {
          answers: [{ question_id: 'q1', answer_value: 3 }],
        }),
      ).rejects.toThrow('Finder attempt is not in progress.');
    });

    it("does not find another user's attempt", async () => {
      const { service, prisma } = createHarness();

      await expect(
        service.submitFinderAnswers('user-1', 'attempt-of-someone-else', {
          answers: [{ question_id: 'q1', answer_value: 3 }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.mbtiFinderAttempt.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'attempt-of-someone-else', userId: 'user-1' },
        }),
      );
    });
  });

  describe('completeFinderAttempt', () => {
    it('scores a fully answered attempt and stores the finder result', async () => {
      const { service, prisma, tx } = createHarness();
      prisma.mbtiFinderAttempt.findFirst.mockResolvedValue({
        id: 'attempt-1',
        status: FinderAttemptStatus.IN_PROGRESS,
        questionSetVersion: '2026-03-v1',
        answers: await answersFor('ESFJ'),
      });

      const result = await service.completeFinderAttempt('user-1', 'attempt-1');

      expect(result).toMatchObject({
        attempt_id: 'attempt-1',
        predicted_type_code: 'ESFJ',
        confidence_score: 0.99,
        result_summary: {
          cognitive_stack: ['Fe', 'Si', 'Ne', 'Ti'],
        },
        onboarding: { status: OnboardingStatus.MBTI_PENDING },
      });
      expect(result.alternative_types).toHaveLength(2);
      expect(tx.mbtiFinderAttempt.update).toHaveBeenCalledWith({
        where: { id: 'attempt-1' },
        data: expect.objectContaining({
          status: FinderAttemptStatus.COMPLETED,
          predictedTypeCode: 'ESFJ',
          confidenceScore: new Prisma.Decimal('0.9900'),
        }),
      });
      expect(tx.mbtiProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            typeCode: 'ESFJ',
            source: MbtiSource.FINDER_RESULT,
            isUserConfirmed: false,
            finderVersion: '2026-03-v1',
          }),
        }),
      );
    });

    it('refuses to complete an attempt with unanswered questions', async () => {
      const { service, prisma, tx } = createHarness();
      prisma.mbtiFinderAttempt.findFirst.mockResolvedValue({
        id: 'attempt-1',
        status: FinderAttemptStatus.IN_PROGRESS,
        questionSetVersion: '2026-03-v1',
        answers: (await answersFor('ESFJ')).slice(0, 27),
      });

      await expect(
        service.completeFinderAttempt('user-1', 'attempt-1'),
      ).rejects.toThrow('All finder questions must be answered before completion.');
      expect(tx.mbtiFinderAttempt.update).not.toHaveBeenCalled();
    });

    it('re-reads a completed attempt without writing again', async () => {
      const { service, prisma } = createHarness();
      prisma.mbtiFinderAttempt.findFirst.mockResolvedValue({
        id: 'attempt-1',
        status: FinderAttemptStatus.COMPLETED,
        questionSetVersion: '2026-03-v1',
        answers: await answersFor('INTP'),
      });

      const result = await service.completeFinderAttempt('user-1', 'attempt-1');

      expect(result.predicted_type_code).toBe('INTP');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses an abandoned attempt', async () => {
      const { service, prisma } = createHarness();
      prisma.mbtiFinderAttempt.findFirst.mockResolvedValue({
        id: 'attempt-1',
        status: FinderAttemptStatus.ABANDONED,
        questionSetVersion: '2026-03-v1',
        answers: [],
      });

      await expect(
        service.completeFinderAttempt('user-1', 'attempt-1'),
      ).rejects.toThrow('Finder attempt cannot be completed.');
    });
  });

  describe('confirmProfile', () => {
    it('keeps the finder confidence when confirming the finder result as-is', async () => {
      const { service, tx } = createHarness({
        id: 'user-1',
        onboardingStatus: OnboardingStatus.MBTI_PENDING,
        mbtiProfile: {
          typeCode: 'INFJ',
          source: MbtiSource.FINDER_RESULT,
          confidenceScore: new Prisma.Decimal('0.8700'),
          finderVersion: '2026-03-v1',
          profileVersion: '2026-03-v1',
        },
      });

      const result = await service.confirmProfile('user-1', {
        type_code: 'INFJ',
        source: MbtiSource.FINDER_RESULT,
      });

      expect(tx.mbtiProfile.upsert.mock.calls[0][0].create).toMatchObject({
        typeCode: 'INFJ',
        isUserConfirmed: true,
        confidenceScore: new Prisma.Decimal('0.8700'),
        finderVersion: '2026-03-v1',
      });
      expect(result.onboarding).toEqual({
        status: OnboardingStatus.CALENDAR_PENDING,
        next_step: 'CALENDAR_CONNECT',
        is_completed: false,
      });
    });

    it('drops the finder confidence when the user confirms a different type', async () => {
      const { service, tx } = createHarness({
        id: 'user-1',
        onboardingStatus: OnboardingStatus.MBTI_PENDING,
        mbtiProfile: {
          typeCode: 'INFJ',
          source: MbtiSource.FINDER_RESULT,
          confidenceScore: new Prisma.Decimal('0.8700'),
          finderVersion: '2026-03-v1',
          profileVersion: '2026-03-v1',
        },
      });

      await service.confirmProfile('user-1', {
        type_code: 'INFP',
        source: MbtiSource.FINDER_RESULT,
      });

      expect(tx.mbtiProfile.upsert.mock.calls[0][0].create).toMatchObject({
        typeCode: 'INFP',
        confidenceScore: null,
        finderVersion: null,
      });
    });

    it('keeps a completed user completed when they change their type later', async () => {
      const { service, tx } = createHarness({
        id: 'user-1',
        onboardingStatus: OnboardingStatus.COMPLETED,
        mbtiProfile: null,
      });

      const result = await service.confirmProfile('user-1', {
        type_code: 'ENTJ',
        source: MbtiSource.SELF_SELECTED,
      });

      expect(tx.user.update.mock.calls[0][0].data.onboardingStatus).toBe(
        OnboardingStatus.COMPLETED,
      );
      expect(result.onboarding.next_step).toBe('HOME');
    });
  });
});
