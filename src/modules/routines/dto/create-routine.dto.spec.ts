import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { CreateRoutineDto } from './create-routine.dto';

async function errorsFor(payload: Record<string, unknown>) {
  const errors = await validate(plainToInstance(CreateRoutineDto, payload));
  return errors.map((error) => error.property);
}

describe('CreateRoutineDto', () => {
  it('accepts timesPerWeek without daysOfWeek', async () => {
    expect(await errorsFor({ title: '운동하기', timesPerWeek: 3 })).toEqual([]);
  });

  it.each([0, 7, 2.5])('rejects timesPerWeek %p', async (timesPerWeek) => {
    expect(await errorsFor({ title: '운동하기', timesPerWeek })).toEqual([
      'timesPerWeek',
    ]);
  });

  describe('recommendationWindow', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    });
    const transform = (recommendationWindow: unknown) => pipe.transform(
      { title: '운동하기', timesPerWeek: 3, recommendationWindow },
      { type: 'body', metatype: CreateRoutineDto },
    );

    it.each([
      null,
      { mode: 'ANYTIME' },
      { mode: 'CLOCK', startMinutes: 0, endMinutes: 1439 },
      { mode: 'CLOCK', startMinutes: 1439, endMinutes: 0 },
      { mode: 'AFTER_WAKE', durationMinutes: 1 },
      { mode: 'AFTER_WAKE', durationMinutes: 1440 },
      { mode: 'BEFORE_SLEEP', durationMinutes: 1 },
      { mode: 'BEFORE_SLEEP', durationMinutes: 1440 },
    ])('preserves valid input through the actual ValidationPipe: %j', async (window) => {
      const dto = await transform(window);
      expect(dto.recommendationWindow).toEqual(window);
      expect(await errorsFor({ title: '운동하기', timesPerWeek: 3, recommendationWindow: window })).toEqual([]);
    });

    it.each([
      'CLOCK', 3, true, [], {},
      { mode: 'UNKNOWN' },
      { mode: 'CLOCK', startMinutes: 60 },
      { mode: 'CLOCK', endMinutes: 60 },
      { mode: 'CLOCK', startMinutes: 60, endMinutes: 60 },
      { mode: 'CLOCK', startMinutes: -1, endMinutes: 60 },
      { mode: 'CLOCK', startMinutes: 1440, endMinutes: 60 },
      { mode: 'CLOCK', startMinutes: 60, endMinutes: -1 },
      { mode: 'CLOCK', startMinutes: 60, endMinutes: 1440 },
      { mode: 'CLOCK', startMinutes: 1.5, endMinutes: 60 },
      { mode: 'CLOCK', startMinutes: 60, endMinutes: 1.5 },
      { mode: 'CLOCK', startMinutes: '0', endMinutes: 60 },
      { mode: 'CLOCK', startMinutes: 0, endMinutes: '60' },
      { mode: 'CLOCK', startMinutes: null, endMinutes: 60 },
      { mode: 'CLOCK', startMinutes: 0, endMinutes: true },
      { mode: 'CLOCK', startMinutes: 0, endMinutes: 60, durationMinutes: 10 },
      { mode: 'AFTER_WAKE' },
      { mode: 'AFTER_WAKE', durationMinutes: 0 },
      { mode: 'AFTER_WAKE', durationMinutes: 1441 },
      { mode: 'AFTER_WAKE', durationMinutes: 1.5 },
      { mode: 'AFTER_WAKE', durationMinutes: '60' },
      { mode: 'AFTER_WAKE', durationMinutes: null },
      { mode: 'AFTER_WAKE', durationMinutes: 60, startMinutes: 0 },
      { mode: 'BEFORE_SLEEP' },
      { mode: 'BEFORE_SLEEP', durationMinutes: 0 },
      { mode: 'BEFORE_SLEEP', durationMinutes: 1441 },
      { mode: 'BEFORE_SLEEP', durationMinutes: false },
      { mode: 'ANYTIME', durationMinutes: 60 },
      { mode: 'ANYTIME', extra: true },
    ].map((window) => [window]))('rejects invalid input without coercing or stripping fields: %j', async (window) => {
      expect(await errorsFor({ title: '운동하기', timesPerWeek: 3, recommendationWindow: window })).toContain('recommendationWindow');
      await expect(transform(window)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
