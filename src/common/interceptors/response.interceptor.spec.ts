import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';

import { ResponseInterceptor } from './response.interceptor';

function run(value: unknown) {
  const next: CallHandler = { handle: () => of(value) };

  return lastValueFrom(
    new ResponseInterceptor().intercept({} as ExecutionContext, next),
  );
}

describe('ResponseInterceptor', () => {
  it.each([
    ['an object', { id: 'task-1' }],
    ['an array', [1, 2, 3]],
    ['a string', 'ok'],
    ['a number', 0],
    ['null', null],
    ['undefined', undefined],
  ])('wraps %s in a data envelope', async (_label, value) => {
    await expect(run(value)).resolves.toEqual({ data: value });
  });

  it.each([
    ['data', { data: { id: 1 } }],
    ['error', { error: { code: 'X' } }],
    ['items', { items: [], next_cursor: null }],
  ])('passes through payloads that already have %s', async (_key, value) => {
    await expect(run(value)).resolves.toBe(value);
  });
});
