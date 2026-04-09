import { BadRequestException } from '@nestjs/common';

import {
  buildUtcDayRange,
  formatLocalDate,
  parseLocalDate,
  resolveRequestedLocalDate,
} from './local-date.util';

describe('local-date.util', () => {
  describe('parseLocalDate', () => {
    it('should parse a valid YYYY-MM-DD string', () => {
      const result = parseLocalDate('2026-04-09');

      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe('2026-04-09T00:00:00.000Z');
    });

    it('should throw on invalid format', () => {
      expect(() => parseLocalDate('04-09-2026')).toThrow(BadRequestException);
      expect(() => parseLocalDate('2026/04/09')).toThrow(BadRequestException);
      expect(() => parseLocalDate('')).toThrow(BadRequestException);
    });
  });

  describe('formatLocalDate', () => {
    it('should format a Date to YYYY-MM-DD', () => {
      const date = new Date('2026-04-09T00:00:00.000Z');

      expect(formatLocalDate(date)).toBe('2026-04-09');
    });
  });

  describe('buildUtcDayRange', () => {
    it('should return start and end of the UTC day', () => {
      const range = buildUtcDayRange('2026-04-09');

      expect(range.start.toISOString()).toBe('2026-04-09T00:00:00.000Z');
      expect(range.end.toISOString()).toBe('2026-04-10T00:00:00.000Z');
    });
  });

  describe('resolveRequestedLocalDate', () => {
    it('should return the provided date if valid', () => {
      expect(resolveRequestedLocalDate('2026-04-09', 'Asia/Seoul')).toBe(
        '2026-04-09',
      );
    });

    it('should resolve from timezone when no date provided', () => {
      const result = resolveRequestedLocalDate(undefined, 'Asia/Seoul');

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should throw on invalid format', () => {
      expect(() =>
        resolveRequestedLocalDate('invalid', 'Asia/Seoul'),
      ).toThrow(BadRequestException);
    });
  });
});
