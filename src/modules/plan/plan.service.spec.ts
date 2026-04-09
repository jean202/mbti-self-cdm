import { NotFoundException } from '@nestjs/common';

import { PlanService } from './plan.service';

const DEMO_USER = {
  id: 'user-1',
  timezone: 'Asia/Seoul',
  locale: 'ko-KR',
  mbtiProfile: { typeCode: 'INFJ', profileVersion: '2026-03-v1' },
};

const DEMO_TASK = {
  id: 'task-1',
  title: '발표 준비',
  note: null,
  status: 'PLANNED',
  sourceType: 'MANUAL',
  dueAt: new Date('2026-04-09T09:00:00Z'),
  localDueDate: new Date('2026-04-09'),
  energyEstimate: 3,
  sortOrder: 1,
  completedAt: null,
  createdAt: new Date('2026-04-01'),
};

const DEMO_PROFILE = {
  planning_style: {
    style_key: 'vision_anchor',
    today_strategy: 'single_thread_focus',
    week_strategy: 'theme_blocks',
    backlog_strategy: 'meaning_filter',
    default_sort: ['priority', 'due_date'],
  },
  copy: {
    'ko-KR': {
      plan: {
        today_prompt: '오늘 가장 중요한 한 줄기를 먼저 보호하세요.',
        week_prompt: '이번 주의 테마를 먼저 정해보세요.',
        backlog_prompt: '의미 있는 것만 남기세요.',
      },
    },
  },
};

function createMockPrisma(overrides: Record<string, any> = {}) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(DEMO_USER),
    },
    todayFocus: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'focus-1',
        localDate: new Date('2026-04-09'),
        title: '오늘의 초점',
        note: null,
        status: 'ACTIVE',
      }),
    },
    task: {
      findMany: jest.fn().mockResolvedValue([DEMO_TASK]),
      update: jest.fn().mockResolvedValue(DEMO_TASK),
    },
    idea: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    calendarConnection: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    calendarEvent: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as any;
}

function createMockProfileLoader(profile: unknown = DEMO_PROFILE) {
  return {
    getProfile: jest.fn().mockResolvedValue(profile),
  } as any;
}

describe('PlanService', () => {
  describe('getToday', () => {
    it('should return today plan with tasks and personalization', async () => {
      const service = new PlanService(
        createMockPrisma(),
        createMockProfileLoader(),
      );

      const result = await service.getToday('user-1', '2026-04-09');

      expect(result.local_date).toBe('2026-04-09');
      expect(result.today_focus).not.toBeNull();
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].title).toBe('발표 준비');
      expect(result.personalization.planning_style).not.toBeNull();
      expect(result.personalization.planning_style!.style_key).toBe(
        'vision_anchor',
      );
      expect(result.personalization.prompt).toBe(
        '오늘 가장 중요한 한 줄기를 먼저 보호하세요.',
      );
    });

    it('should return null personalization without MBTI profile', async () => {
      const userNoMbti = { ...DEMO_USER, mbtiProfile: null };
      const prisma = createMockPrisma({
        user: { findUnique: jest.fn().mockResolvedValue(userNoMbti) },
      });
      const service = new PlanService(prisma, createMockProfileLoader());

      const result = await service.getToday('user-1', '2026-04-09');

      expect(result.personalization.planning_style).toBeNull();
      expect(result.personalization.prompt).toBeNull();
    });

    it('should throw for missing user', async () => {
      const prisma = createMockPrisma({
        user: { findUnique: jest.fn().mockResolvedValue(null) },
      });
      const service = new PlanService(prisma, createMockProfileLoader());

      await expect(
        service.getToday('nonexistent', '2026-04-09'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getWeek', () => {
    it('should return week plan with tasks and calendar events', async () => {
      const service = new PlanService(
        createMockPrisma(),
        createMockProfileLoader(),
      );

      const result = await service.getWeek('user-1', {
        week_start: '2026-04-06',
      });

      expect(result.week_start).toBe('2026-04-06');
      expect(result.tasks).toHaveLength(1);
      expect(result.calendar_events).toHaveLength(0);
      expect(result.personalization.prompt).toBe(
        '이번 주의 테마를 먼저 정해보세요.',
      );
    });
  });

  describe('getBacklog', () => {
    it('should return backlog with tasks and ideas', async () => {
      const service = new PlanService(
        createMockPrisma(),
        createMockProfileLoader(),
      );

      const result = await service.getBacklog('user-1', {});

      expect(result.tasks).toBeDefined();
      expect(result.ideas).toBeDefined();
      expect(result.personalization.prompt).toBe('의미 있는 것만 남기세요.');
    });
  });

  describe('reorderTasks', () => {
    it('should update sort order for tasks', async () => {
      const prisma = createMockPrisma();
      const service = new PlanService(prisma, createMockProfileLoader());

      const result = await service.reorderTasks('user-1', {
        local_date: '2026-04-09',
        items: [
          { task_id: 'task-1', sort_order: 2 },
        ],
      });

      expect(result.updated_count).toBe(1);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should throw when tasks not found', async () => {
      const prisma = createMockPrisma({
        task: {
          findMany: jest.fn().mockResolvedValue([]),
          update: jest.fn(),
        },
      });
      const service = new PlanService(prisma, createMockProfileLoader());

      await expect(
        service.reorderTasks('user-1', {
          local_date: '2026-04-09',
          items: [{ task_id: 'nonexistent', sort_order: 1 }],
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
