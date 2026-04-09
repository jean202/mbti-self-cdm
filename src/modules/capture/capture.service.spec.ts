import { NotFoundException } from '@nestjs/common';

import { CaptureService } from './capture.service';

function createMockPrisma(user: unknown = null) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
    },
  } as any;
}

function createMockProfileLoader(profile: unknown = null) {
  return {
    getProfile: jest.fn().mockResolvedValue(profile),
  } as any;
}

const BASE_USER = {
  locale: 'ko-KR',
  mbtiProfile: null,
};

const INFJ_USER = {
  locale: 'ko-KR',
  mbtiProfile: { typeCode: 'INFJ', profileVersion: '2026-03-v1' },
};

describe('CaptureService', () => {
  describe('analyze', () => {
    it('should return TASK when input contains actionable keywords', async () => {
      const service = new CaptureService(
        createMockPrisma(BASE_USER),
        createMockProfileLoader(),
      );

      const result = await service.analyze('user-1', {
        input_text: '내일까지 보고서 제출하기',
      });

      expect(result.suggested_target).toBe('TASK');
      expect(result.reason).toBe('actionable');
      expect(result.normalized_title).toBe('내일까지 보고서 제출하기');
    });

    it('should return IDEA when input contains exploratory keywords', async () => {
      const service = new CaptureService(
        createMockPrisma(BASE_USER),
        createMockProfileLoader(),
      );

      const result = await service.analyze('user-1', {
        input_text: '새로운 아이디어 브레인스토밍 해볼까',
      });

      expect(result.suggested_target).toBe('IDEA');
      expect(result.reason).toBe('exploratory');
    });

    it('should boost TASK score when local_date is provided', async () => {
      const service = new CaptureService(
        createMockPrisma(BASE_USER),
        createMockProfileLoader(),
      );

      const result = await service.analyze('user-1', {
        input_text: '미팅 준비',
        local_date: '2026-04-10',
      });

      expect(result.suggested_target).toBe('TASK');
      expect(result.reason).toBe('date_provided');
    });

    it('should fall back to type default bias when no signals match', async () => {
      const profile = {
        task_capture_style: { default_target_bias: 'IDEA' },
        copy: {},
      };
      const service = new CaptureService(
        createMockPrisma(INFJ_USER),
        createMockProfileLoader(profile),
      );

      const result = await service.analyze('user-1', {
        input_text: '점심 메뉴',
      });

      expect(result.suggested_target).toBe('IDEA');
      expect(result.reason).toBe('type_default_idea');
    });

    it('should include capture hints from type profile', async () => {
      const profile = {
        task_capture_style: { default_target_bias: 'TASK' },
        copy: {
          'ko-KR': {
            capture: {
              placeholder: '무엇을 하시겠어요?',
              task_hint: '할 일을 적어주세요',
              idea_hint: '떠오르는 생각을 적어주세요',
            },
          },
        },
      };
      const service = new CaptureService(
        createMockPrisma(INFJ_USER),
        createMockProfileLoader(profile),
      );

      const result = await service.analyze('user-1', {
        input_text: '점심',
      });

      expect(result.capture_hints).toEqual({
        placeholder: '무엇을 하시겠어요?',
        task_hint: '할 일을 적어주세요',
        idea_hint: '떠오르는 생각을 적어주세요',
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      const service = new CaptureService(
        createMockPrisma(null),
        createMockProfileLoader(),
      );

      await expect(
        service.analyze('nonexistent', { input_text: 'test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
