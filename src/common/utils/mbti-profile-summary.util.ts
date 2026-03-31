import type { MbtiProfile } from '@prisma/client';

type MbtiProfileSummarySource = Pick<
  MbtiProfile,
  'typeCode' | 'source' | 'isUserConfirmed' | 'confidenceScore' | 'profileVersion'
>;

export function toMbtiProfileSummary(profile: MbtiProfileSummarySource) {
  return {
    type_code: profile.typeCode,
    source: profile.source,
    is_user_confirmed: profile.isUserConfirmed,
    confidence_score: profile.confidenceScore
      ? Number(profile.confidenceScore)
      : null,
    profile_version: profile.profileVersion,
  };
}
