import { Injectable } from '@nestjs/common';

import type {
  MbtiFinderAxis,
  MbtiFinderQuestionSet,
} from './mbti-finder-question-set.service';

type FinderAnswerInput = {
  questionId: string;
  answerValue: number;
};

export type MbtiFinderScoreResult = {
  predictedTypeCode: string;
  confidenceScore: number;
  alternativeTypes: string[];
};

const ALL_TYPE_CODES = [
  'ISTJ',
  'ISFJ',
  'INFJ',
  'INTJ',
  'ISTP',
  'ISFP',
  'INFP',
  'INTP',
  'ESTP',
  'ESFP',
  'ENFP',
  'ENTP',
  'ESTJ',
  'ESFJ',
  'ENFJ',
  'ENTJ',
] as const;

const AXIS_CONFIG = {
  EI: { positiveLetter: 'E', index: 0 },
  SN: { positiveLetter: 'S', index: 1 },
  TF: { positiveLetter: 'T', index: 2 },
  JP: { positiveLetter: 'J', index: 3 },
} as const;

@Injectable()
export class MbtiFinderScoringService {
  scoreAttempt(
    questionSet: MbtiFinderQuestionSet,
    answers: FinderAnswerInput[],
  ): MbtiFinderScoreResult {
    const answerMap = new Map(
      answers.map((answer) => [answer.questionId, answer.answerValue]),
    );
    const axisScores = this.createAxisValueMap(0);
    const axisMax = this.createAxisValueMap(0);

    for (const question of questionSet.questions) {
      const answerValue = answerMap.get(question.id);

      if (typeof answerValue !== 'number') {
        continue;
      }

      axisScores[question.axis] += (answerValue - 3) * question.direction;
      axisMax[question.axis] += 2;
    }

    const axisNormalized = this.createAxisValueMap(0);

    for (const axis of Object.keys(axisNormalized) as MbtiFinderAxis[]) {
      axisNormalized[axis] =
        axisMax[axis] > 0 ? axisScores[axis] / axisMax[axis] : 0;
    }

    const candidates = ALL_TYPE_CODES.map((typeCode) => ({
      typeCode,
      score: this.scoreCandidate(typeCode, axisNormalized),
    })).sort((left, right) => right.score - left.score);

    const predictedType = candidates[0]?.typeCode ?? 'INFJ';
    const averageAxisConfidence =
      (Math.abs(axisNormalized.EI) +
        Math.abs(axisNormalized.SN) +
        Math.abs(axisNormalized.TF) +
        Math.abs(axisNormalized.JP)) /
      4;
    const confidenceScore = Number(
      Math.max(
        0,
        Math.min(0.99, 0.5 + averageAxisConfidence * 0.49),
      ).toFixed(4),
    );

    return {
      predictedTypeCode: predictedType,
      confidenceScore,
      alternativeTypes: candidates
        .filter((candidate) => candidate.typeCode !== predictedType)
        .slice(0, 2)
        .map((candidate) => candidate.typeCode),
    };
  }

  private createAxisValueMap(defaultValue: number): Record<MbtiFinderAxis, number> {
    return {
      EI: defaultValue,
      SN: defaultValue,
      TF: defaultValue,
      JP: defaultValue,
    };
  }

  private scoreCandidate(
    typeCode: string,
    axisNormalized: Record<MbtiFinderAxis, number>,
  ): number {
    return (Object.keys(axisNormalized) as MbtiFinderAxis[]).reduce(
      (score, axis) => score + this.axisSignForType(axis, typeCode) * axisNormalized[axis],
      0,
    );
  }

  private axisSignForType(axis: MbtiFinderAxis, typeCode: string): 1 | -1 {
    const config = AXIS_CONFIG[axis];
    const typeLetter = typeCode[config.index];

    return typeLetter === config.positiveLetter ? 1 : -1;
  }
}
