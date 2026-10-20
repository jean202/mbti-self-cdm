import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MbtiFinderQuestionSetService } from './mbti-finder-question-set.service';
import { MbtiFinderScoringService } from './mbti-finder-scoring.service';

function createService(dataRoot?: string) {
  return new MbtiFinderQuestionSetService({
    get: jest.fn((key: string) =>
      key === 'MBTI_FINDER_DATA_ROOT' ? dataRoot : undefined,
    ),
  } as unknown as ConfigService);
}

describe('MbtiFinderQuestionSetService', () => {
  describe('with the bundled question sets', () => {
    const service = createService();

    it('loads the newest version by default', async () => {
      const versions = await service.listVersions();
      const questionSet = await service.getQuestionSet();

      expect(versions.length).toBeGreaterThan(0);
      expect(questionSet.questionSetVersion).toBe(versions[0]);
    });

    it('stays inside the 24-32 question range the product promises', async () => {
      const { questions } = await service.getQuestionSet('2026-03-v1');

      expect(questions.length).toBeGreaterThanOrEqual(24);
      expect(questions.length).toBeLessThanOrEqual(32);
    });

    it('uses unique ids and a contiguous order', async () => {
      const { questions } = await service.getQuestionSet('2026-03-v1');

      expect(new Set(questions.map((question) => question.id)).size).toBe(
        questions.length,
      );
      expect(questions.map((question) => question.order)).toEqual(
        questions.map((_, index) => index + 1),
      );
    });

    it('asks every axis in both directions so acquiescence bias cancels out', async () => {
      const { questions } = await service.getQuestionSet('2026-03-v1');

      for (const axis of ['EI', 'SN', 'TF', 'JP'] as const) {
        const onAxis = questions.filter((question) => question.axis === axis);
        const positive = onAxis.filter((question) => question.direction === 1);
        const negative = onAxis.filter((question) => question.direction === -1);

        expect(positive.length).toBeGreaterThan(0);
        expect(negative.length).toBeGreaterThan(0);
        expect(Math.abs(positive.length - negative.length)).toBeLessThanOrEqual(1);
      }
    });

    it('can produce each of the 16 types from consistent answers', async () => {
      const questionSet = await service.getQuestionSet('2026-03-v1');
      const scoring = new MbtiFinderScoringService();
      const positiveLetters = { EI: 'E', SN: 'S', TF: 'T', JP: 'J' } as const;
      const axisIndex = { EI: 0, SN: 1, TF: 2, JP: 3 } as const;
      const typeCodes = ['E', 'I'].flatMap((a) =>
        ['S', 'N'].flatMap((b) =>
          ['T', 'F'].flatMap((c) => ['J', 'P'].map((d) => `${a}${b}${c}${d}`)),
        ),
      );

      for (const typeCode of typeCodes) {
        const answers = questionSet.questions.map((question) => {
          const wantsPositive =
            typeCode[axisIndex[question.axis]] === positiveLetters[question.axis];
          const agrees = wantsPositive === (question.direction === 1);

          return { questionId: question.id, answerValue: agrees ? 5 : 1 };
        });

        const result = scoring.scoreAttempt(questionSet, answers);

        expect({ typeCode, predicted: result.predictedTypeCode }).toEqual({
          typeCode,
          predicted: typeCode,
        });
        expect(result.confidenceScore).toBe(0.99);
      }
    });

    it('gives the lowest confidence when every answer is neutral', async () => {
      const questionSet = await service.getQuestionSet('2026-03-v1');
      const result = new MbtiFinderScoringService().scoreAttempt(
        questionSet,
        questionSet.questions.map((question) => ({
          questionId: question.id,
          answerValue: 3,
        })),
      );

      expect(result.confidenceScore).toBe(0.5);
    });

    it('caches parsed question sets', async () => {
      const first = await service.getQuestionSet('2026-03-v1');
      const second = await service.getQuestionSet('2026-03-v1');

      expect(second).toBe(first);
    });

    it.each(['../type-profiles/2026-03-v1/INFP', 'nested/version', '..', '.hidden'])(
      'rejects the path-like version %p before touching the file system',
      async (version) => {
        await expect(service.getQuestionSet(version)).rejects.toBeInstanceOf(
          BadRequestException,
        );
      },
    );

    it('reports a missing version without leaking the data directory', async () => {
      const error = await service
        .getQuestionSet('1999-01-v9')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).message).toBe(
        'MBTI finder question set was not found: 1999-01-v9',
      );
    });
  });

  describe('with a custom data root', () => {
    let dataRoot: string;

    beforeEach(() => {
      dataRoot = mkdtempSync(join(tmpdir(), 'finder-sets-'));
    });

    afterEach(() => {
      rmSync(dataRoot, { recursive: true, force: true });
    });

    function writeSet(name: string, body: unknown) {
      writeFileSync(join(dataRoot, `${name}.json`), JSON.stringify(body));
    }

    it('drops malformed questions, sorts by order and defaults the scale', async () => {
      writeSet('v2', {
        question_set_version: 'v2-final',
        scale: [1, 2.5, 3],
        questions: [
          { id: 'b', prompt: 'B', order: 2, axis: 'SN', direction: -1 },
          { id: 'a', prompt: 'A', order: 1, axis: 'EI', direction: 1 },
          { id: 'bad-axis', prompt: 'X', order: 3, axis: 'XY', direction: 1 },
          { id: 'bad-direction', prompt: 'Y', order: 4, axis: 'TF', direction: 0 },
          { prompt: 'no id', order: 5, axis: 'JP', direction: 1 },
          'not-an-object',
        ],
      });

      const questionSet = await createService(dataRoot).getQuestionSet('v2');

      expect(questionSet.questionSetVersion).toBe('v2-final');
      expect(questionSet.scale).toEqual([1, 2, 3, 4, 5]);
      expect(questionSet.questions.map((question) => question.id)).toEqual([
        'a',
        'b',
      ]);
    });

    it('treats a set without valid questions as not found', async () => {
      writeSet('empty', { questions: [{ id: 'x' }] });

      await expect(
        createService(dataRoot).getQuestionSet('empty'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('picks the lexicographically newest file and ignores non-json files', async () => {
      const question = { id: 'q', prompt: 'Q', order: 1, axis: 'EI', direction: 1 };
      writeSet('2026-01-v1', { questions: [question] });
      writeSet('2026-05-v1', { questions: [question] });
      writeFileSync(join(dataRoot, 'README.md'), '# notes');

      const service = createService(dataRoot);

      expect(await service.listVersions()).toEqual(['2026-05-v1', '2026-01-v1']);
      expect((await service.getQuestionSet()).questionSetVersion).toBe('2026-05-v1');
    });

    it('fails clearly when no question set exists', async () => {
      await expect(createService(dataRoot).getQuestionSet()).rejects.toThrow(
        'No MBTI finder question set was found.',
      );
    });
  });
});
