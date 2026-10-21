import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ListIdeasQueryDto } from './list-ideas-query.dto';
import { UpdateIdeaDto } from './update-idea.dto';

const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false });
const patch = (payload: unknown) => pipe.transform(payload, { type: 'body', metatype: UpdateIdeaDto });
const query = (payload: unknown) => pipe.transform(payload, { type: 'query', metatype: ListIdeasQueryDto });

describe('Thought inbox DTOs through the real validation pipe', () => {
  it.each(['2026-10-18', '2028-02-29', '2000-02-29'])('preserves a valid date-only review value %s', async (date) => {
    expect(await patch({ review_on: date })).toHaveProperty('review_on', date);
    expect(await query({ review_before: date })).toHaveProperty('review_before', date);
  });
  it('allows explicit review clearing without stripping null', async () => {
    expect(await patch({ review_on: null })).toHaveProperty('review_on', null);
  });
  it.each(['2026-02-29', '2026-02-30', '2026-04-31', '2026-00-01', '2026-13-01', '0000-01-01', '2026-1-01', '2026-10-18T00:00:00Z', ' 2026-10-18', '2026-10-18\n', '', 20261018, [], {}])('rejects invalid or non-date-only values %j', async (date) => {
    await expect(patch({ review_on: date })).rejects.toBeInstanceOf(BadRequestException);
    await expect(query({ review_before: date })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('only permits ACTIVE and ARCHIVED status mutations', async () => {
    await expect(patch({ status: 'CONVERTED' })).rejects.toBeInstanceOf(BadRequestException);
    expect(await patch({ status: 'ARCHIVED' })).toHaveProperty('status', 'ARCHIVED');
    expect(await patch({ status: 'ACTIVE' })).toHaveProperty('status', 'ACTIVE');
  });
  it('preserves search and opaque cursor parameters', async () => {
    expect(await query({ q: 'Old BODY', cursor: 'opaque-cursor-token', limit: '20' })).toEqual(expect.objectContaining({ q: 'Old BODY', cursor: 'opaque-cursor-token', limit: 20 }));
  });
});
