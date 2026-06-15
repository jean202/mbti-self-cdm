import { NotFoundException } from '@nestjs/common';

import { HomeService } from './home.service';

const DEMO_USER = {
  id: 'user-1',
  locale: 'ko-KR',
  timezone: 'Asia/Seoul',
  mbtiProfile: { typeCode: 'INFJ', profileVersion: '2026-03-v1' },
  calendarConnections: [
    {
      id: 'conn-1',
      status: 'ACTIVE',
      lastSyncedAt: new Date('2026-04-09T00:00:00Z'),
      lastErrorCode: null,
    },
  ],
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
      update: jest.fn().mockResolvedValue(userOverride ?? DEMO_USER),
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
      expect(result.calendar_summary.connection_id).toBe('conn-1');
      expect(result.calendar_summary.connection_status).toBe('ACTIVE');
      expect(result.calendar_summary.items).toHaveLength(1);
      expect(result.personalized_prompt).not.toBeNull();
      expect(result.personalized_prompt!.body).toContain('한 가지 흐름');
      expect(result.trajectory_gap_card).toBeNull();
      expect(result.recovery_card).not.toBeNull();
      expect(result.engagement_nudge).toBeNull();
      expect(result.inactivity_reminder).toMatchObject({
        type_code: 'INFJ',
        delay_days: 3,
        title: '계획이 멈춘 지점만 다시 봐요',
        action_label: '방향 하나 정하기',
      });
      expect(result.home_mode).not.toBeNull();
      expect(result.home_mode!.mode_key).toBe('guided_focus');
    });

    it('should return a soft ESTJ nudge after a long inactive gap', async () => {
      const staleEstjUser = {
        ...DEMO_USER,
        mbtiProfile: { typeCode: 'ESTJ', profileVersion: '2026-03-v1' },
        lastActiveAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        calendarConnections: [],
      };
      const prisma = createMockPrisma(staleEstjUser);
      prisma.todayFocus.findUnique = jest.fn().mockResolvedValue(null);
      prisma.task.findMany = jest.fn().mockResolvedValue([]);
      const service = new HomeService(
        prisma,
        createMockProfileLoader({
          copy: {
            'ko-KR': {
              type_title: 'ESTJ',
              home: {
                opening_prompt: '오늘은 우선순위부터 잡으세요.',
                empty_state_prompt: '오늘의 핵심 우선순위 한 가지를 적어보세요.',
              },
              reminders: {
                samples: ['지금 가장 중요한 우선순위로 다시 돌아갈까요?'],
              },
            },
          },
          reminder_tone: {
            tone_key: 'direct_command',
            intensity_floor: 'medium',
            intensity_ceiling: 'high',
            cadence_bias: 'steady',
          },
        }),
      );

      const result = await service.getHome('user-1', '2026-04-09');

      expect(result.engagement_nudge).toMatchObject({
        state: 'RETURNING_AFTER_BREAK',
        type_code: 'ESTJ',
        intensity: 'low',
        title: '재촉보다 재정렬이 먼저입니다',
        action_label: '부담 큰 일 하나만 적기',
      });
      expect(result.inactivity_reminder).toMatchObject({
        type_code: 'ESTJ',
        tone_key: 'direct_command',
        cadence_bias: 'steady',
        title: '바빴다면 오늘 기준만 다시 정리해요',
        action_label: '오늘 할 일 확인',
      });
    });

    it('should return a softer reminder copy for intuitive perceiving types', async () => {
      const enfpUser = {
        ...DEMO_USER,
        mbtiProfile: { typeCode: 'ENFP', profileVersion: '2026-03-v1' },
      };
      const service = new HomeService(
        createMockPrisma(enfpUser),
        createMockProfileLoader({
          reminder_tone: {
            tone_key: 'energizing_invite',
            intensity_floor: 'low',
            cadence_bias: 'adaptive',
          },
        }),
      );

      const result = await service.getHome('user-1', '2026-04-09');

      expect(result.inactivity_reminder).toMatchObject({
        type_code: 'ENFP',
        intensity: 'low',
        cadence_bias: 'adaptive',
        title: '생각이 흩어졌다면 한 줄만 붙잡기',
        action_label: '생각 하나 남기기',
      });
      expect(result.inactivity_reminder!.body).toContain('관리받는 느낌');
    });

    it('should return a concise INTJ nudge for an empty setup', async () => {
      const intjUser = {
        ...DEMO_USER,
        mbtiProfile: { typeCode: 'INTJ', profileVersion: '2026-03-v1' },
        lastActiveAt: new Date(),
        calendarConnections: [],
      };
      const prisma = createMockPrisma(intjUser);
      prisma.todayFocus.findUnique = jest.fn().mockResolvedValue(null);
      prisma.task.findMany = jest.fn().mockResolvedValue([]);
      const service = new HomeService(
        prisma,
        createMockProfileLoader({
          copy: {
            'ko-KR': {
              type_title: 'INTJ',
              home: {
                opening_prompt: '오늘의 전략을 정리하세요.',
                empty_state_prompt: '전략의 기준부터 잡으세요.',
              },
            },
          },
          reminder_tone: {
            tone_key: 'precise_direct',
            intensity_floor: 'low',
          },
        }),
      );

      const result = await service.getHome('user-1', '2026-04-09');

      expect(result.engagement_nudge).toMatchObject({
        state: 'EMPTY_SETUP',
        type_code: 'INTJ',
        title: '빈 상태입니다',
        action_label: '다음 행동 입력',
      });
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
      expect(result.engagement_nudge).toBeNull();
      expect(result.inactivity_reminder).toBeNull();
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
