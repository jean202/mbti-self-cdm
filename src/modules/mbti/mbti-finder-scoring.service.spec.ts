import type { MbtiFinderQuestionSet } from './mbti-finder-question-set.service';
import { MbtiFinderScoringService } from './mbti-finder-scoring.service';

function makeQuestionSet(
  questions: Array<{
    id: string;
    axis: 'EI' | 'SN' | 'TF' | 'JP';
    direction: 1 | -1;
  }>,
): MbtiFinderQuestionSet {
  return {
    questionSetVersion: 'test-v1',
    scale: [1, 2, 3, 4, 5],
    questions: questions.map((q, i) => ({
      ...q,
      prompt: `Question ${i + 1}`,
      order: i + 1,
    })),
  };
}

// Helper: create answers that strongly favor one side of each axis
// answerValue 5 with direction 1 = strong positive (E, S, T, J)
// answerValue 1 with direction 1 = strong negative (I, N, F, P)
function makeAnswers(
  questionIds: string[],
  value: number,
): Array<{ questionId: string; answerValue: number }> {
  return questionIds.map((id) => ({ questionId: id, answerValue: value }));
}

describe('MbtiFinderScoringService', () => {
  let service: MbtiFinderScoringService;

  beforeEach(() => {
    service = new MbtiFinderScoringService();
  });

  describe('scoreAttempt', () => {
    it('should predict ESTJ when all axes favor E, S, T, J', () => {
      const qs = makeQuestionSet([
        { id: 'q1', axis: 'EI', direction: 1 },
        { id: 'q2', axis: 'EI', direction: 1 },
        { id: 'q3', axis: 'SN', direction: 1 },
        { id: 'q4', axis: 'SN', direction: 1 },
        { id: 'q5', axis: 'TF', direction: 1 },
        { id: 'q6', axis: 'TF', direction: 1 },
        { id: 'q7', axis: 'JP', direction: 1 },
        { id: 'q8', axis: 'JP', direction: 1 },
      ]);

      // All answers = 5 → strong positive on all axes → E, S, T, J
      const answers = makeAnswers(
        ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'],
        5,
      );

      const result = service.scoreAttempt(qs, answers);

      expect(result.predictedTypeCode).toBe('ESTJ');
      expect(result.confidenceScore).toBeGreaterThan(0.8);
      expect(result.alternativeTypes).toHaveLength(2);
    });

    it('should predict INFP when all axes favor I, N, F, P', () => {
      const qs = makeQuestionSet([
        { id: 'q1', axis: 'EI', direction: 1 },
        { id: 'q2', axis: 'SN', direction: 1 },
        { id: 'q3', axis: 'TF', direction: 1 },
        { id: 'q4', axis: 'JP', direction: 1 },
      ]);

      // All answers = 1 → strong negative → I, N, F, P
      const answers = makeAnswers(['q1', 'q2', 'q3', 'q4'], 1);

      const result = service.scoreAttempt(qs, answers);

      expect(result.predictedTypeCode).toBe('INFP');
    });

    it('should handle reversed direction questions', () => {
      const qs = makeQuestionSet([
        { id: 'q1', axis: 'EI', direction: -1 }, // reversed: 1→E, 5→I
        { id: 'q2', axis: 'SN', direction: -1 },
        { id: 'q3', axis: 'TF', direction: -1 },
        { id: 'q4', axis: 'JP', direction: -1 },
      ]);

      // Answer 1 with direction -1 → positive axis → E, S, T, J
      const answers = makeAnswers(['q1', 'q2', 'q3', 'q4'], 1);

      const result = service.scoreAttempt(qs, answers);

      expect(result.predictedTypeCode).toBe('ESTJ');
    });

    it('should return confidence between 0.5 and 0.99', () => {
      const qs = makeQuestionSet([
        { id: 'q1', axis: 'EI', direction: 1 },
        { id: 'q2', axis: 'SN', direction: 1 },
        { id: 'q3', axis: 'TF', direction: 1 },
        { id: 'q4', axis: 'JP', direction: 1 },
      ]);

      // Neutral answers → low confidence
      const neutralAnswers = makeAnswers(['q1', 'q2', 'q3', 'q4'], 3);
      const neutralResult = service.scoreAttempt(qs, neutralAnswers);
      expect(neutralResult.confidenceScore).toBe(0.5);

      // Strong answers → high confidence
      const strongAnswers = makeAnswers(['q1', 'q2', 'q3', 'q4'], 5);
      const strongResult = service.scoreAttempt(qs, strongAnswers);
      expect(strongResult.confidenceScore).toBeGreaterThan(0.8);
      expect(strongResult.confidenceScore).toBeLessThanOrEqual(0.99);
    });

    it('should return exactly 2 alternative types', () => {
      const qs = makeQuestionSet([
        { id: 'q1', axis: 'EI', direction: 1 },
        { id: 'q2', axis: 'SN', direction: 1 },
        { id: 'q3', axis: 'TF', direction: 1 },
        { id: 'q4', axis: 'JP', direction: 1 },
      ]);

      const answers = makeAnswers(['q1', 'q2', 'q3', 'q4'], 4);
      const result = service.scoreAttempt(qs, answers);

      expect(result.alternativeTypes).toHaveLength(2);
      expect(result.alternativeTypes).not.toContain(
        result.predictedTypeCode,
      );
    });

    it('should skip unanswered questions gracefully', () => {
      const qs = makeQuestionSet([
        { id: 'q1', axis: 'EI', direction: 1 },
        { id: 'q2', axis: 'SN', direction: 1 },
        { id: 'q3', axis: 'TF', direction: 1 },
        { id: 'q4', axis: 'JP', direction: 1 },
      ]);

      // Only answer 2 out of 4
      const answers = [
        { questionId: 'q1', answerValue: 5 },
        { questionId: 'q3', answerValue: 5 },
      ];

      const result = service.scoreAttempt(qs, answers);

      expect(result.predictedTypeCode).toBeDefined();
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.5);
    });

    it('should predict INTJ correctly (mixed axes)', () => {
      const qs = makeQuestionSet([
        { id: 'q1', axis: 'EI', direction: 1 },
        { id: 'q2', axis: 'EI', direction: 1 },
        { id: 'q3', axis: 'SN', direction: 1 },
        { id: 'q4', axis: 'SN', direction: 1 },
        { id: 'q5', axis: 'TF', direction: 1 },
        { id: 'q6', axis: 'TF', direction: 1 },
        { id: 'q7', axis: 'JP', direction: 1 },
        { id: 'q8', axis: 'JP', direction: 1 },
      ]);

      const answers = [
        { questionId: 'q1', answerValue: 1 }, // I
        { questionId: 'q2', answerValue: 1 }, // I
        { questionId: 'q3', answerValue: 1 }, // N
        { questionId: 'q4', answerValue: 1 }, // N
        { questionId: 'q5', answerValue: 5 }, // T
        { questionId: 'q6', answerValue: 5 }, // T
        { questionId: 'q7', answerValue: 5 }, // J
        { questionId: 'q8', answerValue: 5 }, // J
      ];

      const result = service.scoreAttempt(qs, answers);

      expect(result.predictedTypeCode).toBe('INTJ');
    });
  });
});
