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
