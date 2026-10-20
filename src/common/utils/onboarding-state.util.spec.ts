import { MbtiSource, OnboardingStatus, Prisma } from '@prisma/client';

import { toMbtiProfileSummary } from './mbti-profile-summary.util';
import { toOnboardingState } from './onboarding-state.util';

describe('toOnboardingState', () => {
  it.each([
    [OnboardingStatus.AUTH_ONLY, 'MBTI_ENTRY', false],
    [OnboardingStatus.MBTI_PENDING, 'MBTI_ENTRY', false],
    [OnboardingStatus.CALENDAR_PENDING, 'CALENDAR_CONNECT', false],
    [OnboardingStatus.COMPLETED, 'HOME', true],
  ])('routes %s to %s', (status, nextStep, isCompleted) => {
    expect(toOnboardingState(status)).toEqual({
      status,
      next_step: nextStep,
      is_completed: isCompleted,
    });
  });
});

describe('toMbtiProfileSummary', () => {
  const profile = {
    typeCode: 'ENTP',
    source: MbtiSource.SELF_SELECTED,
    isUserConfirmed: false,
    profileVersion: '2026-03-v1',
  };

  it('converts the decimal confidence to a number', () => {
    expect(
      toMbtiProfileSummary({
        ...profile,
        confidenceScore: new Prisma.Decimal('0.7350'),
      }),
    ).toEqual({
      type_code: 'ENTP',
      source: MbtiSource.SELF_SELECTED,
      is_user_confirmed: false,
      confidence_score: 0.735,
      profile_version: '2026-03-v1',
    });
  });

  it('keeps a missing confidence as null', () => {
    expect(
      toMbtiProfileSummary({ ...profile, confidenceScore: null }).confidence_score,
    ).toBeNull();
  });
});
