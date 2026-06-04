import { GoalHorizon, GoalStatus, Prisma } from '@prisma/client';

import { GoalsService } from './goals.service';

const GOAL = {
  id: 'goal-1',
  userId: 'user-1',
  title: '포트폴리오 4개 완성',
  note: null,
  horizon: GoalHorizon.MID_TERM,
  status: GoalStatus.ACTIVE,
  targetValue: new Prisma.Decimal(4),
  currentValue: new Prisma.Decimal(1),
  unit: '개',
  startDate: new Date('2026-06-01T00:00:00.000Z'),
  targetDate: new Date('2026-06-20T00:00:00.000Z'),
  completedAt: null,
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
  updatedAt: new Date('2026-06-04T00:00:00.000Z'),
};

function createMockPrisma(goal = GOAL) {
  return {
    goal: {
      findMany: jest.fn().mockResolvedValue([goal]),
      create: jest.fn().mockImplementation(({ data }) => ({
        ...GOAL,
        ...data,
        id: 'goal-new',
        createdAt: GOAL.createdAt,
        updatedAt: GOAL.updatedAt,
      })),
      findFirst: jest.fn().mockResolvedValue(goal),
      update: jest.fn().mockImplementation(({ data }) => ({
        ...goal,
        ...data,
        updatedAt: new Date('2026-06-05T00:00:00.000Z'),
      })),
    },
  } as any;
}

describe('GoalsService', () => {
  it('lists goals with progress and projection fields', async () => {
    const service = new GoalsService(createMockPrisma());

    const result = await service.listGoals('user-1');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].progress.percent).toBeGreaterThanOrEqual(0);
    expect(result.items[0].progress.projected_completion_date).toBeDefined();
    expect(result.summary.active_count).toBe(1);
  });

  it('creates a goal with default current value and unit', async () => {
    const prisma = createMockPrisma();
    const service = new GoalsService(prisma);

    const result = await service.createGoal('user-1', {
      title: '책 6권 읽기',
      horizon: GoalHorizon.LONG_TERM,
      target_value: 6,
    });

    expect(result.id).toBe('goal-new');
    expect(prisma.goal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentValue: new Prisma.Decimal(0),
          unit: '개',
        }),
      }),
    );
  });

  it('marks completed goals as completed with completed_at', async () => {
    const prisma = createMockPrisma();
    const service = new GoalsService(prisma);

    const result = await service.updateGoal('user-1', 'goal-1', {
      status: GoalStatus.COMPLETED,
      current_value: 4,
    });

    expect(result.status).toBe(GoalStatus.COMPLETED);
    expect(result.completed_at).not.toBeNull();
  });
});
