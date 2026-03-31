import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../infra/prisma/prisma.service';
import { TypeProfileLoaderService } from '../type-profiles/type-profile-loader.service';
import { AnalyzeCaptureDto } from './dto/analyze-capture.dto';

type SuggestedTarget = 'TASK' | 'IDEA';

interface AnalyzeResult {
  suggested_target: SuggestedTarget;
  reason: string;
  normalized_title: string;
  capture_hints: {
    placeholder: string | null;
    task_hint: string | null;
    idea_hint: string | null;
  } | null;
}

interface TypeProfileDocument {
  task_capture_style?: {
    default_target_bias?: string;
  };
  copy?: Record<
    string,
    {
      capture?: {
        placeholder?: string;
        task_hint?: string;
        idea_hint?: string;
      };
    }
  >;
}

// Keywords that suggest actionable / time-bound work → TASK
const TASK_SIGNALS = [
  // Korean
  '하기', '해야', '처리', '완료', '마감', '제출', '보내', '수정', '정리하기',
  '확인', '연락', '전화', '답장', '예약', '결제', '구매', '신청', '등록',
  '까지', '오늘', '내일', '이번 주', '다음 주',
  // English
  'do', 'fix', 'send', 'submit', 'finish', 'complete', 'call', 'reply',
  'book', 'pay', 'buy', 'register', 'by', 'today', 'tomorrow', 'deadline',
];

// Keywords that suggest exploratory / open-ended thinking → IDEA
const IDEA_SIGNALS = [
  // Korean
  '아이디어', '생각', '고민', '떠오른', '영감', '해볼까', '해보면',
  '어떨까', '가능할까', '시도', '탐색', '조사', '리서치', '브레인스토밍',
  '메모', '나중에', '언젠가', '혹시',
  // English
  'idea', 'think', 'explore', 'research', 'brainstorm', 'maybe',
  'someday', 'wonder', 'what if', 'could', 'might', 'consider', 'memo',
];

@Injectable()
export class CaptureService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly typeProfileLoaderService: TypeProfileLoaderService,
  ) {}

  async analyze(userId: string, input: AnalyzeCaptureDto): Promise<AnalyzeResult> {
    const text = input.input_text.toLowerCase();
    const normalizedTitle = input.input_text.trim();

    // Load user profile for personalization
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: {
        locale: true,
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

    let defaultBias: SuggestedTarget = 'TASK';
    let captureHints: AnalyzeResult['capture_hints'] = null;

    if (user.mbtiProfile) {
      const profile = (await this.typeProfileLoaderService.getProfile(
        user.mbtiProfile.typeCode,
        user.mbtiProfile.profileVersion ?? undefined,
      )) as TypeProfileDocument | null;

      if (profile) {
        // Apply type-specific default bias
        const bias = profile.task_capture_style?.default_target_bias;
        if (bias === 'IDEA' || bias === 'TASK') {
          defaultBias = bias;
        }

        // Load capture copy
        const locale = user.locale ?? 'ko-KR';
        const copy =
          profile.copy?.[locale]?.capture ?? profile.copy?.['ko-KR']?.capture;
        if (copy) {
          captureHints = {
            placeholder: copy.placeholder ?? null,
            task_hint: copy.task_hint ?? null,
            idea_hint: copy.idea_hint ?? null,
          };
        }
      }
    }

    const taskScore = this.countMatches(text, TASK_SIGNALS);
    const ideaScore = this.countMatches(text, IDEA_SIGNALS);

    // Date presence is a strong task signal
    const hasDate = input.local_date !== undefined;
    const adjustedTaskScore = taskScore + (hasDate ? 2 : 0);

    // Clear keyword winner
    if (adjustedTaskScore > ideaScore) {
      return {
        suggested_target: 'TASK',
        reason: hasDate && taskScore === 0 ? 'date_provided' : 'actionable',
        normalized_title: normalizedTitle,
        capture_hints: captureHints,
      };
    }

    if (ideaScore > adjustedTaskScore) {
      return {
        suggested_target: 'IDEA',
        reason: 'exploratory',
        normalized_title: normalizedTitle,
        capture_hints: captureHints,
      };
    }

    // Tie or no signals → use type-specific default bias
    return {
      suggested_target: defaultBias,
      reason: `type_default_${defaultBias.toLowerCase()}`,
      normalized_title: normalizedTitle,
      capture_hints: captureHints,
    };
  }

  private countMatches(text: string, signals: string[]): number {
    return signals.reduce(
      (count, signal) => count + (text.includes(signal) ? 1 : 0),
      0,
    );
  }
}
