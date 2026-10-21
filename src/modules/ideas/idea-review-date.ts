import { BadRequestException } from '@nestjs/common';
import { ValidateBy } from 'class-validator';

function isReviewDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function IsReviewDate() {
  return ValidateBy({
    name: 'isReviewDate',
    validator: {
      validate: isReviewDate,
      defaultMessage: (args) => `${args?.property} must be a valid YYYY-MM-DD date.`,
    },
  });
}

export function parseReviewDate(value: string): Date {
  if (!isReviewDate(value)) throw new BadRequestException('Review date must be a valid YYYY-MM-DD date.');
  return new Date(`${value}T00:00:00.000Z`);
}
