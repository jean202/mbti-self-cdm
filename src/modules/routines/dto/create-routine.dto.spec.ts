import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

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
});
