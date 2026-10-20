import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  authed,
  createE2eApp,
  expectStatus,
  loginNewUser,
  type E2eApp,
} from './support/e2e-app';

type QuestionFile = {
  questions: Array<{ id: string; direction: 1 | -1 }>;
};

const QUESTION_SET = JSON.parse(
  readFileSync(
    join(__dirname, '../data/mbti-finder-question-sets/2026-03-v1.json'),
    'utf8',
  ),
) as QuestionFile;

// 모든 축에서 음의 글자(I, N, F, P)로 기울도록 답하면 INFP가 나온다.
function answersLeaningInfp() {
  return QUESTION_SET.questions.map((question) => ({
    question_id: question.id,
    answer_value: question.direction === 1 ? 1 : 5,
  }));
}

describe('MBTI onboarding (e2e)', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('lists all 16 types with a four-function cognitive stack', async () => {
    const user = await loginNewUser(ctx.app);

    const response = await expectStatus(
      authed(ctx.app, user, { method: 'GET', url: '/v1/mbti/type-catalog' }),
      200,
    );
    const catalog = response.json().data as Array<{
      type_code: string;
      title: string;
      cognitive_stack: string[];
    }>;

    expect(catalog).toHaveLength(16);
    expect(new Set(catalog.map((item) => item.type_code)).size).toBe(16);
    for (const item of catalog) {
      expect(item.type_code).toMatch(/^[EI][SN][TF][JP]$/);
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.cognitive_stack).toHaveLength(4);
    }
  });

  it('walks self-selection → confirmation → calendar skip to a completed onboarding', async () => {
    const user = await loginNewUser(ctx.app);

    const selected = await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: '/v1/mbti/profile/self-selection',
        payload: { type_code: 'infj' },
      }),
      201,
    );
    expect(selected.json().data).toMatchObject({
      mbti_profile: {
        type_code: 'INFJ',
        source: 'SELF_SELECTED',
        is_user_confirmed: false,
      },
      onboarding: { status: 'MBTI_PENDING', next_step: 'MBTI_CONFIRMATION' },
    });

    const confirmed = await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: '/v1/mbti/profile/confirm',
        payload: { type_code: 'INFJ', source: 'SELF_SELECTED' },
      }),
      201,
    );
    expect(confirmed.json().data.onboarding).toMatchObject({
      status: 'CALENDAR_PENDING',
      next_step: 'CALENDAR_CONNECT',
      is_completed: false,
    });

    const skipped = await expectStatus(
      authed(ctx.app, user, { method: 'POST', url: '/v1/onboarding/calendar/skip' }),
      201,
    );
    expect(skipped.json().data.onboarding).toMatchObject({
      status: 'COMPLETED',
      next_step: 'HOME',
      is_completed: true,
    });

    const me = await expectStatus(
      authed(ctx.app, user, { method: 'GET', url: '/v1/me' }),
      200,
    );
    expect(me.json().data).toMatchObject({
      user: { onboarding_status: 'COMPLETED' },
      mbti_profile: { type_code: 'INFJ', is_user_confirmed: true },
    });
  });

  it('refuses to skip calendar onboarding before MBTI is confirmed', async () => {
    const user = await loginNewUser(ctx.app);

    const response = await authed(ctx.app, user, {
      method: 'POST',
      url: '/v1/onboarding/calendar/skip',
    });

    expect(response.statusCode).toBe(409);
  });

  it('rejects malformed type codes', async () => {
    const user = await loginNewUser(ctx.app);

    const response = await authed(ctx.app, user, {
      method: 'POST',
      url: '/v1/mbti/profile/self-selection',
      payload: { type_code: 'ABCD' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('scores a full finder attempt and keeps the finder confidence on confirmation', async () => {
    const user = await loginNewUser(ctx.app);

    const started = await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: '/v1/mbti/finder/attempts',
        payload: {},
      }),
      201,
    );
    const attempt = started.json().data;
    expect(attempt.status).toBe('IN_PROGRESS');
    expect(attempt.questions).toHaveLength(QUESTION_SET.questions.length);
    expect(attempt.progress).toEqual({
      answered_count: 0,
      total_count: QUESTION_SET.questions.length,
    });

    const resumed = await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: '/v1/mbti/finder/attempts',
        payload: {},
      }),
      201,
    );
    expect(resumed.json().data.attempt_id).toBe(attempt.attempt_id);

    const incomplete = await authed(ctx.app, user, {
      method: 'POST',
      url: `/v1/mbti/finder/attempts/${attempt.attempt_id}/complete`,
    });
    expect(incomplete.statusCode).toBe(400);

    const submitted = await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: `/v1/mbti/finder/attempts/${attempt.attempt_id}/answers`,
        payload: { answers: answersLeaningInfp() },
      }),
      201,
    );
    expect(submitted.json().data.progress.answered_count).toBe(
      QUESTION_SET.questions.length,
    );

    const completed = await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: `/v1/mbti/finder/attempts/${attempt.attempt_id}/complete`,
      }),
      201,
    );
    const result = completed.json().data;
    expect(result.predicted_type_code).toBe('INFP');
    expect(result.confidence_score).toBeGreaterThan(0.5);
    expect(result.alternative_types).not.toContain('INFP');
    expect(result.result_summary.cognitive_stack).toEqual(
      expect.arrayContaining([expect.any(String)]),
    );

    const confirmed = await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: '/v1/mbti/profile/confirm',
        payload: { type_code: 'INFP', source: 'FINDER_RESULT' },
      }),
      201,
    );
    expect(confirmed.json().data.mbti_profile).toMatchObject({
      type_code: 'INFP',
      source: 'FINDER_RESULT',
      is_user_confirmed: true,
      confidence_score: expect.any(Number),
    });
  });

  it('rejects unknown and duplicate finder answers', async () => {
    const user = await loginNewUser(ctx.app);
    const started = await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: '/v1/mbti/finder/attempts',
        payload: {},
      }),
      201,
    );
    const attemptId = started.json().data.attempt_id;

    const unknown = await authed(ctx.app, user, {
      method: 'POST',
      url: `/v1/mbti/finder/attempts/${attemptId}/answers`,
      payload: { answers: [{ question_id: 'q-does-not-exist', answer_value: 3 }] },
    });
    expect(unknown.statusCode).toBe(400);

    const duplicate = await authed(ctx.app, user, {
      method: 'POST',
      url: `/v1/mbti/finder/attempts/${attemptId}/answers`,
      payload: {
        answers: [
          { question_id: 'q1', answer_value: 3 },
          { question_id: 'q1', answer_value: 4 },
        ],
      },
    });
    expect(duplicate.statusCode).toBe(400);

    const outOfScale = await authed(ctx.app, user, {
      method: 'POST',
      url: `/v1/mbti/finder/attempts/${attemptId}/answers`,
      payload: { answers: [{ question_id: 'q1', answer_value: 9 }] },
    });
    expect(outOfScale.statusCode).toBe(400);
  });

  it("does not expose another user's finder attempt", async () => {
    const owner = await loginNewUser(ctx.app);
    const other = await loginNewUser(ctx.app);
    const started = await expectStatus(
      authed(ctx.app, owner, {
        method: 'POST',
        url: '/v1/mbti/finder/attempts',
        payload: {},
      }),
      201,
    );

    const response = await authed(ctx.app, other, {
      method: 'GET',
      url: `/v1/mbti/finder/attempts/${started.json().data.attempt_id}`,
    });

    expect(response.statusCode).toBe(404);
  });

  it('rejects question set versions that try to escape the data directory', async () => {
    const user = await loginNewUser(ctx.app);

    const response = await authed(ctx.app, user, {
      method: 'POST',
      url: '/v1/mbti/finder/attempts',
      payload: { question_set_version: '../type-profiles/2026-03-v1/INFP' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.payload).not.toContain(process.cwd());
  });
});
