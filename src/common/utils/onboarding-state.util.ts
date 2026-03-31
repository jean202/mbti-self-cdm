import { OnboardingStatus } from '@prisma/client';

export function toOnboardingState(status: OnboardingStatus) {
  switch (status) {
    case OnboardingStatus.AUTH_ONLY:
    case OnboardingStatus.MBTI_PENDING:
      return {
        status,
        next_step: 'MBTI_ENTRY' as const,
        is_completed: false,
      };
    case OnboardingStatus.CALENDAR_PENDING:
      return {
        status,
        next_step: 'CALENDAR_CONNECT' as const,
        is_completed: false,
      };
    case OnboardingStatus.COMPLETED:
      return {
        status,
        next_step: 'HOME' as const,
        is_completed: true,
      };
  }
}
