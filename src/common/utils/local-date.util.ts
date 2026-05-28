import { BadRequestException } from '@nestjs/common';

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function resolveRequestedLocalDate(
  localDate: string | undefined,
  timezone: string,
): string {
  if (localDate) {
    assertLocalDate(localDate);

    return localDate;
  }

  return formatNowInTimezone(timezone);
}

export function parseLocalDate(localDate: string): Date {
  assertLocalDate(localDate);

  const date = new Date(`${localDate}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('local_date must be YYYY-MM-DD.');
  }

  return date;
}

export function formatLocalDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildUtcDayRange(localDate: string): {
  start: Date;
  end: Date;
} {
  const start = parseLocalDate(localDate);
  const end = new Date(start);

  end.setUTCDate(end.getUTCDate() + 1);

  return { start, end };
}

export function buildUtcDayRangeForTimezone(
  localDate: string,
  timezone: string,
): {
  start: Date;
  end: Date;
} {
  assertLocalDate(localDate);

  const nextDate = parseLocalDate(localDate);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);

  return {
    start: zonedDateTimeToUtc(localDate, timezone),
    end: zonedDateTimeToUtc(formatLocalDate(nextDate), timezone),
  };
}

function assertLocalDate(localDate: string): void {
  if (!LOCAL_DATE_PATTERN.test(localDate)) {
    throw new BadRequestException('local_date must be YYYY-MM-DD.');
  }
}

function formatNowInTimezone(timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new BadRequestException('Failed to resolve user local date.');
  }

  return `${year}-${month}-${day}`;
}

function zonedDateTimeToUtc(localDate: string, timezone: string): Date {
  const [year, month, day] = localDate.split('-').map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const offset = getTimezoneOffsetMs(utcGuess, timezone);
  let result = new Date(utcGuess.getTime() - offset);
  const correctedOffset = getTimezoneOffsetMs(result, timezone);

  if (correctedOffset !== offset) {
    result = new Date(utcGuess.getTime() - correctedOffset);
  }

  return result;
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const timezoneName = formatter
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value;

  if (!timezoneName) {
    throw new BadRequestException('Failed to resolve timezone offset.');
  }

  const match = timezoneName.match(/^GMT(?:(?<sign>[+-])(?<hour>\d{1,2})(?::(?<minute>\d{2}))?)?$/);

  if (!match?.groups) {
    throw new BadRequestException('Failed to resolve timezone offset.');
  }

  const sign = match.groups.sign === '-' ? -1 : 1;
  const hour = Number(match.groups.hour ?? '0');
  const minute = Number(match.groups.minute ?? '0');

  return sign * (hour * 60 + minute) * 60 * 1000;
}
