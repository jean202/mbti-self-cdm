import { ApiProperty } from '@nestjs/swagger';
import { isISO8601, ValidateBy } from 'class-validator';

const TIMESTAMP_WITH_TIMEZONE = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/;

export function isScheduleDueAt(value: unknown): value is string {
  return typeof value === 'string'
    && TIMESTAMP_WITH_TIMEZONE.test(value)
    && isISO8601(value, { strict: true, strictSeparator: true })
    && Number.isFinite(new Date(value).getTime());
}

export class ScheduleRoutineDto {
  @ApiProperty({
    description: '예약 시각. UTC Z 또는 시간대 오프셋이 포함된 ISO 8601 문자열',
    example: '2026-05-30T08:30:00+09:00',
    format: 'date-time',
  })
  @ValidateBy({
    name: 'isScheduleDueAt',
    validator: {
      validate: isScheduleDueAt,
      defaultMessage: () => 'dueAt must be a valid ISO 8601 timestamp with Z or a timezone offset.',
    },
  })
  dueAt!: string;
}
