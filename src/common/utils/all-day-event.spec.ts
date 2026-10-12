import { calendarEventBoundary } from './all-day-event';

describe('calendarEventBoundary', () => {
  it('interprets date-only events at user local midnight', () => {
    expect(calendarEventBoundary('2026-10-09', true, 'Asia/Seoul').toISOString())
      .toBe('2026-10-08T15:00:00.000Z');
    expect(calendarEventBoundary('2026-10-10', true, 'Asia/Seoul').toISOString())
      .toBe('2026-10-09T15:00:00.000Z');
  });
  it('preserves timed events', () => {
    expect(calendarEventBoundary('2026-10-09T10:00:00+09:00', false, 'Asia/Seoul').toISOString())
      .toBe('2026-10-09T01:00:00.000Z');
  });
});
