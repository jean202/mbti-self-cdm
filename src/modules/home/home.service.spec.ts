import { NotFoundException } from '@nestjs/common';

import { HomeService } from './home.service';

const DEMO_USER = {
  id: 'user-1',
  locale: 'ko-KR',
  timezone: 'Asia/Seoul',
  mbtiProfile: { typeCode: 'INFJ', profileVersion: '2026-03-v1' },
  calendarConnections: [{ id: 'conn-1' }],
};

const DEMO_FOCUS = {
  id: 'focus-1',
  localDate: new Date('2026-04-09'),
  title: '오늘의 초점',
  note: null,
  status: 'ACTIVE',
};

const DEMO_TASK = {
  id: 'task-1',
  title: '발표 준비',
  status: 'PLANNED',
  dueAt: new Date('2026-04-09T09:00:00Z'),
};

const DEMO_EVENT = {
  id: 'event-1',
  title: '팀 회의',
  startsAt: new Date('2026-04-09T01:00:00Z'),
  endsAt: new Date('2026-04-09T02:00:00Z'),
};

const DEMO_PROFILE = {
  copy: {
    'ko-KR': {
      type_title: 'INFJ — 통찰의 옹호자',
      home: { opening_prompt: '오늘은 한 가지 흐름만 잡아도 충분합니다.' },
      recovery: {
        card_title: '흐름을 다시 모으는 10분',
        card_body: '입력을 줄이고, 가장 중요한 한 가지를 다시 잡아보세요.',
      },
    },
  },
  home_mode: {
    mode_key: 'guided_focus',
    default_interaction: 'prompted',
    card_priority: ['today_focus', 'personalized_prompt'],
  },
  stress_signals: [{ key: 'fragmented_commitments' }],
};

function createMockPrisma(userOverride?: unknown) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(userOverride ?? DEMO_USER),
    },
    todayFocus: {
      findUnique: jest.fn().mockResolvedValue(DEMO_FOCUS),
      upsert: jest.fn().mockImplementation(({ create }) => ({
        ...DEMO_FOCUS,
        ...create,
        id: 'focus-new',
      })),
    },
    task: {
      findMany: jest.fn().mockResolvedValue([DEMO_TASK]),
      findFirst: jest.fn().mockResolvedValue(DEMO_TASK),
    },
    calendarEvent: {
      findMany: jest.fn().mockResolvedValue([DEMO_EVENT]),
    },
  } as any;
}

function createMockProfileLoader(profile: unknown = DEMO_PROFILE) {
  return {
    getProfile: jest.fn().mockResolvedValue(profile),
  } as any;
}

describe('HomeService', () => {
  describe('getHome', () => {
    it('should return personalized home payload', async () => {
      const service = new HomeService(
        createMockPrisma(),
        createMockProfileLoader(),
      );

      const result = await service.getHome('user-1', '2026-04-09');

      expect(result.today_focus).not.toBeNull();
      expect(result.today_focus!.title).toBe('오늘의 초점');
      expect(result.top_tasks).toHaveLength(1);
      expect(result.calendar_summary.has_connection).toBe(true);
      expect(result.calendar_summary.items).toHaveLength(1);
      expect(result.personalized_prompt).not.toBeNull();
      expect(result.personalized_prompt!.body).toContain('한 가지 흐름');
      expect(result.recovery_card).not.toBeNull();
      expect(result.home_mode).not.toBeNull();
      expect(result.home_mode!.mode_key).toBe('guided_focus');
    });

    it('should return null personalization when no MBTI profile', async () => {
      const userWithoutMbti = { ...DEMO_USER, mbtiProfile: null };
      const service = new HomeService(
        createMockPrisma(userWithoutMbti),
        createMockProfileLoader(),
      );

      const result = await service.getHome('user-1', '2026-04-09');

      expect(result.personalized_prompt).toBeNull();
      expect(result.recovery_card).toBeNull();
      expect(result.home_mode).toBeNull();
    });

    it('should return empty calendar when no connections', async () => {
      const userNoCalendar = { ...DEMO_USER, calendarConnections: [] };
      const service = new HomeService(
        createMockPrisma(userNoCalendar),
        createMockProfileLoader(),
      );

      const result = await service.getHome('user-1', '2026-04-09');

      expect(result.calendar_summary.has_connection).toBe(false);
      expect(result.calendar_summary.items).toHaveLength(0);
    });

    it('should throw NotFoundException for missing user', async () => {
      const prisma = createMockPrisma();
      prisma.user.findUnique = jest.fn().mockResolvedValue(null);
      const service = new HomeService(prisma, createMockProfileLoader());

      await expect(
        service.getHome('nonexistent', '2026-04-09'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('upsertTodayFocus', () => {
    it('should create/update today focus', async () => {
      const service = new HomeService(
        createMockPrisma(),
        createMockProfileLoader(),
      );

      const result = await service.upsertTodayFocus('user-1', {
        local_date: '2026-04-09',
        title: '새로운 초점',
      });

      expect(result.title).toBe('새로운 초점');
      expect(result.local_date).toBe('2026-04-09');
    });

    it('should throw when linked task not found', async () => {
      const prisma = createMockPrisma();
      prisma.task.findFirst = jest.fn().mockResolvedValue(null);
      const service = new HomeService(prisma, createMockProfileLoader());

      await expect(
        service.upsertTodayFocus('user-1', {
          local_date: '2026-04-09',
          title: '초점',
          linked_task_id: 'nonexistent',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
