import {
  authed,
  createE2eApp,
  expectStatus,
  loginOnboardedUser,
  type E2eApp,
  type LoggedInUser,
} from './support/e2e-app';

function todayInSeoul(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

describe('Daily loop (e2e)', () => {
  let ctx: E2eApp;
  let user: LoggedInUser;
  const localDate = todayInSeoul();

  beforeAll(async () => {
    ctx = await createE2eApp();
    user = await loginOnboardedUser(ctx.app, 'ENFP');
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function createTask(title: string, extra: Record<string, unknown> = {}) {
    const response = await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: '/v1/tasks',
        payload: { title, source_type: 'MANUAL', ...extra },
      }),
      201,
    );

    return response.json().data;
  }

  it('creates, updates, completes and lists tasks', async () => {
    const task = await createTask('e2e 보고서 초안');
    expect(task).toMatchObject({ id: expect.any(String), title: 'e2e 보고서 초안' });

    const updated = await expectStatus(
      authed(ctx.app, user, {
        method: 'PATCH',
        url: `/v1/tasks/${task.id}`,
        payload: { title: 'e2e 보고서 최종', note: '숫자 검증' },
      }),
      200,
    );
    expect(updated.json().data).toMatchObject({
      title: 'e2e 보고서 최종',
      note: '숫자 검증',
    });

    const completed = await expectStatus(
      authed(ctx.app, user, { method: 'POST', url: `/v1/tasks/${task.id}/complete` }),
      201,
    );
    expect(completed.json().data.status).toBe('DONE');

    const done = await expectStatus(
      authed(ctx.app, user, { method: 'GET', url: '/v1/tasks?status=DONE' }),
      200,
    );
    const doneIds = done.json().items.map((item: { id: string }) => item.id);
    expect(doneIds).toContain(task.id);
  });

  it('validates task input and route parameters', async () => {
    const emptyTitle = await authed(ctx.app, user, {
      method: 'POST',
      url: '/v1/tasks',
      payload: { title: '', source_type: 'MANUAL' },
    });
    expect(emptyTitle.statusCode).toBe(400);

    const badSource = await authed(ctx.app, user, {
      method: 'POST',
      url: '/v1/tasks',
      payload: { title: 'x', source_type: 'TELEPATHY' },
    });
    expect(badSource.statusCode).toBe(400);

    const badId = await authed(ctx.app, user, {
      method: 'GET',
      url: '/v1/tasks/not-a-uuid',
    });
    expect(badId.statusCode).toBe(400);

    const missing = await authed(ctx.app, user, {
      method: 'GET',
      url: '/v1/tasks/00000000-0000-4000-8000-000000000000',
    });
    expect(missing.statusCode).toBe(404);
  });

  it("keeps one user's tasks and ideas invisible to another user", async () => {
    const task = await createTask('비공개 할 일');
    const stranger = await loginOnboardedUser(ctx.app);

    const read = await authed(ctx.app, stranger, {
      method: 'GET',
      url: `/v1/tasks/${task.id}`,
    });
    expect(read.statusCode).toBe(404);

    const write = await authed(ctx.app, stranger, {
      method: 'PATCH',
      url: `/v1/tasks/${task.id}`,
      payload: { title: '탈취' },
    });
    expect(write.statusCode).toBe(404);

    const list = await expectStatus(
      authed(ctx.app, stranger, { method: 'GET', url: '/v1/tasks' }),
      200,
    );
    const ids = list.json().items.map((item: { id: string }) => item.id);
    expect(ids).not.toContain(task.id);
  });

  it('captures an idea and converts it into a task exactly once', async () => {
    const idea = await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: '/v1/ideas',
        payload: { title: '주간 회고 템플릿', tags: ['회고', '템플릿'] },
      }),
      201,
    );
    const ideaId = idea.json().data.id;

    const converted = await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: `/v1/ideas/${ideaId}/convert-to-task`,
        payload: {},
      }),
      201,
    );
    const conversion = converted.json().data;
    expect(JSON.stringify(conversion)).toContain('주간 회고 템플릿');

    const reloaded = await expectStatus(
      authed(ctx.app, user, { method: 'GET', url: `/v1/ideas/${ideaId}` }),
      200,
    );
    expect(reloaded.json().data.status).toBe('CONVERTED');

    const again = await authed(ctx.app, user, {
      method: 'POST',
      url: `/v1/ideas/${ideaId}/convert-to-task`,
      payload: {},
    });
    expect(again.statusCode).toBeGreaterThanOrEqual(400);
    expect(again.statusCode).toBeLessThan(500);
  });

  it('sets today focus and shows it on home', async () => {
    const task = await createTask('오늘의 핵심 작업');

    const focus = await expectStatus(
      authed(ctx.app, user, {
        method: 'PUT',
        url: '/v1/today-focus',
        payload: {
          local_date: localDate,
          title: '핵심 한 가지 끝내기',
          linked_task_id: task.id,
        },
      }),
      200,
    );
    expect(JSON.stringify(focus.json().data)).toContain('핵심 한 가지 끝내기');

    const home = await expectStatus(
      authed(ctx.app, user, {
        method: 'GET',
        url: `/v1/home?local_date=${localDate}`,
      }),
      200,
    );
    expect(JSON.stringify(home.json().data)).toContain('핵심 한 가지 끝내기');
  });

  it('serves today, week and backlog plans and reorders tasks', async () => {
    const first = await createTask('정렬 A');
    const second = await createTask('정렬 B');

    for (const view of [
      `/v1/plan/today?local_date=${localDate}`,
      `/v1/plan/week?week_start=${localDate}`,
      '/v1/plan/backlog',
    ]) {
      await expectStatus(authed(ctx.app, user, { method: 'GET', url: view }), 200);
    }

    await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: '/v1/tasks/reorder',
        payload: {
          local_date: localDate,
          items: [
            { task_id: second.id, sort_order: 0 },
            { task_id: first.id, sort_order: 1 },
          ],
        },
      }),
      201,
    );

    const reloaded = await expectStatus(
      authed(ctx.app, user, { method: 'GET', url: `/v1/tasks/${second.id}` }),
      200,
    );
    expect(reloaded.json().data.sort_order).toBe(0);
  });

  it('records an evening check-in and reflection for the day', async () => {
    const check = await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: '/v1/mood-energy-checks',
        payload: {
          local_date: localDate,
          context: 'EVENING',
          mood_score: 4,
          energy_score: 2,
        },
      }),
      201,
    );
    const checkId = check.json().data.id;

    const reflection = await expectStatus(
      authed(ctx.app, user, {
        method: 'PUT',
        url: `/v1/reflections/${localDate}`,
        payload: {
          mood_energy_check_id: checkId,
          completed_summary: '초안 완료',
          carry_forward_note: '내일 검토',
        },
      }),
      200,
    );
    const reflectionId = reflection.json().data.id;
    expect(reflection.json().data).toMatchObject({
      id: expect.any(String),
      local_date: localDate,
    });

    const daily = await expectStatus(
      authed(ctx.app, user, {
        method: 'GET',
        url: `/v1/reflect/daily?local_date=${localDate}`,
      }),
      200,
    );
    expect(daily.json().data).toMatchObject({
      mood_energy_check: { id: checkId, mood_score: 4, energy_score: 2 },
      existing_reflection_id: reflectionId,
      already_submitted: true,
    });
    expect(daily.json().data.reflection_prompts.length).toBeGreaterThan(0);

    const outOfRange = await authed(ctx.app, user, {
      method: 'POST',
      url: '/v1/mood-energy-checks',
      payload: {
        local_date: localDate,
        context: 'EVENING',
        mood_score: 0,
        energy_score: 6,
      },
    });
    expect(outOfRange.statusCode).toBe(400);
  });

  it('tracks goal progress', async () => {
    const created = await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: '/v1/goals',
        payload: { title: '책 4권 읽기', horizon: 'MID_TERM', target_value: 4 },
      }),
      201,
    );
    const goal = created.json().data;

    const updated = await expectStatus(
      authed(ctx.app, user, {
        method: 'PATCH',
        url: `/v1/goals/${goal.id}`,
        payload: { current_value: 2 },
      }),
      200,
    );
    expect(updated.json().data.progress.percent).toBe(50);

    const list = await expectStatus(
      authed(ctx.app, user, { method: 'GET', url: '/v1/goals' }),
      200,
    );
    const ids = list.json().items.map((item: { id: string }) => item.id);
    expect(ids).toContain(goal.id);
  });

  it("creates a daily routine and generates today's routine task", async () => {
    await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: '/v1/routines',
        payload: { title: '아침 스트레칭', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] },
      }),
      201,
    );

    await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: `/v1/routines/generate-today?local_date=${localDate}`,
      }),
      201,
    );

    const routines = await expectStatus(
      authed(ctx.app, user, {
        method: 'GET',
        url: `/v1/routines?local_date=${localDate}`,
      }),
      200,
    );
    expect(JSON.stringify(routines.json())).toContain('아침 스트레칭');
  });

  it('analyzes quick capture text without persisting anything', async () => {
    const response = await expectStatus(
      authed(ctx.app, user, {
        method: 'POST',
        url: '/v1/capture/analyze',
        payload: { input_text: '내일 오후 3시 치과 예약', local_date: localDate },
      }),
      201,
    );

    expect(response.json().data).toBeDefined();
  });
});
