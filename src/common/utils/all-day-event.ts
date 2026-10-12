import { buildUtcDayRangeForTimezone } from './local-date.util';

export function calendarEventBoundary(value: string, isAllDay: boolean, timezone: string): Date {
  return isAllDay && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? buildUtcDayRangeForTimezone(value, timezone).start
    : new Date(value);
}
