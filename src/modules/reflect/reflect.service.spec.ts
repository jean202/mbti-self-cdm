import { ConflictException, NotFoundException } from '@nestjs/common';

import { ReflectService } from './reflect.service';

const DEMO_USER = {
  id: 'user-1',
  locale: 'ko-KR',
  timezone: 'Asia/Seoul',
  mbtiProfile: { typeCode: 'INFJ', profileVersion: '2026-03-v1' },
};

const DEMO_PROFILE = {
  copy: {
    'ko-KR': {
      review_prompt_labels: {
        direction_alignment: '오늘 한 일이 내가 중요하게 여긴 방향과 맞았나요?',
        energy_reflection: '에너지를 가장 많이 쓴 순간은 언제인가요?',
      },
      recovery: {
        card_title: '흐름을 다시 모으는 10분',
        card_body: '가장 중요한 한 가지를 다시 잡아보세요.',
      },
    },
  },
  recovery_protocol: { default_duration_minutes: 10 },
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
        status: 'ACTIVE',
      }),
    },
    task: {
      findMany: jest.fn().mockResolvedValue([
        { status: 'DONE' },
        { status: 'DONE' },
        { status: 'IN_PROGRESS' },
      ]),
    },
    moodEnergyCheck: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => ({
        ...data,
        id: 'check-new',
        createdAt: new Date(),
      })),
    },
    reflection: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation(({ create }) => ({
        id: 'ref-1',
        localDate: create.localDate,
        submittedAt: new Date(),
      })),
    },
    ...overrides,
  } as any;
}

function createMockProfileLoader(profile: unknown = DEMO_PROFILE) {
  return {
    getProfile: jest.fn().mockResolvedValue(profile),
  } as any;
}

describe('ReflectService', () => {
  describe('getDaily', () => {
    it('should return aggregated daily reflection data', async () => {
      const service = new ReflectService(
        createMockPrisma(),
        createMockProfileLoader(),
      );

      const result = await service.getDaily('user-1', '2026-04-09');

      expect(result.today_focus).not.toBeNull();
      expect(result.task_summary.completed_count).toBe(2);
      expect(result.task_summary.incomplete_count).toBe(1);
      expect(result.reflection_prompts).toHaveLength(2);
      expect(result.mindfulness_recommendation).not.toBeNull();
      expect(result.mindfulness_recommendation!.duration_minutes).toBe(10);
    });

    it('should return empty prompts when no MBTI profile', async () => {
      const userNoMbti = { ...DEMO_USER, mbtiProfile: null };
      const prisma = createMockPrisma({
        user: { findUnique: jest.fn().mockResolvedValue(userNoMbti) },
      });
      const service = new ReflectService(prisma, createMockProfileLoader());

      const result = await service.getDaily('user-1', '2026-04-09');

      expect(result.reflection_prompts).toHaveLength(0);
      expect(result.mindfulness_recommendation).toBeNull();
    });

    it('should throw for missing user', async () => {
      const prisma = createMockPrisma({
        user: { findUnique: jest.fn().mockResolvedValue(null) },
      });
      const service = new ReflectService(prisma, createMockProfileLoader());

      await expect(
        service.getDaily('nonexistent', '2026-04-09'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createMoodEnergyCheck', () => {
    it('should create a mood-energy check', async () => {
      const prisma = createMockPrisma();
      const service = new ReflectService(prisma, createMockProfileLoader());

      const result = await service.createMoodEnergyCheck('user-1', {
        local_date: '2026-04-09',
        context: 'EVENING' as any,
        mood_score: 4,
        energy_score: 3,
      });

      expect(result.mood_score).toBe(4);
      expect(result.energy_score).toBe(3);
      expect(prisma.moodEnergyCheck.create).toHaveBeenCalled();
    });

    it('should throw ConflictException on duplicate', async () => {
      const prisma = createMockPrisma();
      prisma.moodEnergyCheck.findUnique = jest
        .fn()
        .mockResolvedValue({ id: 'existing' });
      const service = new ReflectService(prisma, createMockProfileLoader());

      await expect(
        service.createMoodEnergyCheck('user-1', {
          local_date: '2026-04-09',
          context: 'EVENING' as any,
          mood_score: 4,
          energy_score: 3,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('upsertReflection', () => {
    it('should upsert a reflection', async () => {
      const prisma = createMockPrisma();
      const service = new ReflectService(prisma, createMockProfileLoader());

      const result = await service.upsertReflection('user-1', '2026-04-09', {
        completed_summary: '오늘 2건 완료',
      });

      expect(result.id).toBe('ref-1');
      expect(result.local_date).toBe('2026-04-09');
      expect(result.submitted_at).not.toBeNull();
      expect(prisma.reflection.upsert).toHaveBeenCalled();
    });

    it('should throw when linked today_focus not found', async () => {
      const prisma = createMockPrisma();
      prisma.todayFocus.findFirst = jest.fn().mockResolvedValue(null);
      const service = new ReflectService(prisma, createMockProfileLoader());

      await expect(
        service.upsertReflection('user-1', '2026-04-09', {
          today_focus_id: 'nonexistent',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
