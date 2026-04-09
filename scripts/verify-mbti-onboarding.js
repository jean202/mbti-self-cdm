const { OnboardingStatus } = require('@prisma/client');

const { PrismaService } = require('../dist/infra/prisma/prisma.service');
const {
  MbtiFinderQuestionSetService,
} = require('../dist/modules/mbti/mbti-finder-question-set.service');
const {
  MbtiFinderScoringService,
} = require('../dist/modules/mbti/mbti-finder-scoring.service');
const { MbtiService } = require('../dist/modules/mbti/mbti.service');
const {
  TypeProfileLoaderService,
} = require('../dist/modules/type-profiles/type-profile-loader.service');

const USER_ID = '11111111-1111-4111-8111-111111111121';
const TARGET_TYPE = 'INFJ';

async function main() {
  const configService = {
    get(key) {
      return process.env[key];
    },
  };
  const prismaService = new PrismaService();
  const typeProfileLoaderService = new TypeProfileLoaderService(configService);
  const finderQuestionSetService = new MbtiFinderQuestionSetService(configService);
  const finderScoringService = new MbtiFinderScoringService();
  const mbtiService = new MbtiService(
    prismaService,
    typeProfileLoaderService,
    finderQuestionSetService,
    finderScoringService,
  );

  try {
    await prismaService.mbtiFinderAttempt.deleteMany({
      where: {
        userId: USER_ID,
      },
    });
    await prismaService.mbtiProfile.deleteMany({
      where: {
        userId: USER_ID,
      },
    });
    await prismaService.user.upsert({
      where: {
        id: USER_ID,
      },
      create: {
        id: USER_ID,
        displayName: 'MBTI Onboarding Demo User',
        locale: 'ko-KR',
        timezone: 'Asia/Seoul',
        onboardingStatus: OnboardingStatus.MBTI_PENDING,
      },
      update: {
        displayName: 'MBTI Onboarding Demo User',
        locale: 'ko-KR',
        timezone: 'Asia/Seoul',
        onboardingStatus: OnboardingStatus.MBTI_PENDING,
      },
    });

    const catalog = await mbtiService.getTypeCatalog(USER_ID);
    const selfSelection = await mbtiService.selfSelectProfile(USER_ID, {
      type_code: 'INFP',
    });
    const questionSet = await finderQuestionSetService.getQuestionSet();
    const attempt = await mbtiService.startFinderAttempt(USER_ID, {
      question_set_version: questionSet.questionSetVersion,
    });
    const allAnswers = buildAnswers(questionSet, TARGET_TYPE);
    const midpoint = Math.floor(allAnswers.length / 2);
    const firstSave = await mbtiService.submitFinderAnswers(
      USER_ID,
      attempt.attempt_id,
      {
        answers: allAnswers.slice(0, midpoint),
      },
    );
    const resumed = await mbtiService.getFinderAttempt(USER_ID, attempt.attempt_id);
    const secondSave = await mbtiService.submitFinderAnswers(
      USER_ID,
      attempt.attempt_id,
      {
        answers: allAnswers.slice(midpoint),
      },
    );
    const completed = await mbtiService.completeFinderAttempt(
      USER_ID,
      attempt.attempt_id,
    );
    const confirmed = await mbtiService.confirmProfile(USER_ID, {
      type_code: completed.predicted_type_code,
      source: 'FINDER_RESULT',
    });

    console.log(
      JSON.stringify(
        {
          catalog_count: catalog.length,
          self_selection: selfSelection,
          attempt_started: {
            attempt_id: attempt.attempt_id,
            question_set_version: attempt.question_set_version,
            total_count: attempt.progress.total_count,
          },
          first_save: firstSave,
          resumed_progress: resumed.progress,
          resumed_answers_count: resumed.answers.length,
          second_save: secondSave,
          completed,
          confirmed,
        },
        null,
        2,
      ),
    );
  } finally {
    await prismaService.$disconnect();
  }
}

function buildAnswers(questionSet, targetType) {
  const targetSigns = {
    EI: targetType[0] === 'E' ? 1 : -1,
    SN: targetType[1] === 'S' ? 1 : -1,
    TF: targetType[2] === 'T' ? 1 : -1,
    JP: targetType[3] === 'J' ? 1 : -1,
  };

  return questionSet.questions.map((question, index) => {
    const alignedPositive = targetSigns[question.axis] === question.direction;
    const strongValue = index % 2 === 0 ? 5 : 4;

    return {
      question_id: question.id,
      answer_value: alignedPositive ? strongValue : 6 - strongValue,
    };
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
