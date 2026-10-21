import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IdeaStatus, Prisma } from '@prisma/client';
import { IdeasService } from './ideas.service';

const USER = '9d717e4f-5152-4e49-8ff2-2bc4bcc50823';
const ID = '2187af27-aa48-4195-9335-1a62b160ffb2';
const OTHER_ID = 'cc717e4f-5152-4e49-8ff2-2bc4bcc50824';
const DATE = new Date('2026-10-18T00:00:00.000Z');
const base = {
  id: ID, userId: USER, title: 'Thought', note: 'Old body text',
  status: IdeaStatus.ACTIVE, reviewOn: DATE, tagsJson: null,
  convertedTaskId: null, archivedAt: null, createdAt: DATE, updatedAt: DATE,
};
function setup() {
  const idea = {
    findFirst: jest.fn().mockResolvedValue(base),
    findMany: jest.fn().mockResolvedValue([base]),
    create: jest.fn().mockImplementation(({ data }) => ({ ...base, ...data })),
    update: jest.fn().mockImplementation(({ data }) => ({ ...base, ...data })),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const task = { create: jest.fn().mockResolvedValue({ id: 'task-1', title: 'Thought', status: 'INBOX' }), deleteMany: jest.fn() };
  const prisma = {
    idea, task,
    user: { findUnique: jest.fn().mockResolvedValue({ id: USER, timezone: 'Asia/Seoul' }) },
    $transaction: jest.fn().mockImplementation((fn) => fn({ idea, task })),
  };
  return { prisma, service: new IdeasService(prisma as any) };
}

describe('Thought inbox service contract', () => {
  it('returns date-only review_on, timestamps, and explicit null after clearing', async () => {
    const { prisma, service } = setup();
    expect(await service.getIdea(USER, ID)).toEqual(expect.objectContaining({
      review_on: '2026-10-18', created_at: '2026-10-18T00:00:00.000Z', updated_at: '2026-10-18T00:00:00.000Z',
    }));
    prisma.idea.findFirst.mockResolvedValue({ ...base, reviewOn: null });
    expect(await service.getIdea(USER, ID)).toHaveProperty('review_on', null);
  });

  it('passes a case-insensitive title/body search while retaining ownership and status', async () => {
    const { prisma, service } = setup();
    await service.listIdeas(USER, { q: 'old BODY', limit: 20 } as any);
    expect(prisma.idea.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: USER, status: { not: 'ARCHIVED' }, OR: [
        { title: { contains: 'old BODY', mode: 'insensitive' } },
        { note: { contains: 'old BODY', mode: 'insensitive' } },
      ] }),
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 21,
    }));
  });

  it('applies inclusive due-date filtering only to ACTIVE ideas', async () => {
    const { prisma, service } = setup();
    await service.listIdeas(USER, { review_before: '2026-10-18' } as any);
    expect(prisma.idea.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: USER, status: 'ACTIVE', reviewOn: { lte: DATE } }),
    }));
  });

  it('does not return ACTIVE rows when an ARCHIVED + review filter is requested', async () => {
    const { prisma, service } = setup();
    const result = await service.listIdeas(USER, { status: IdeaStatus.ARCHIVED, review_before: '2026-10-18' } as any);
    expect(result.items).toEqual([]);
    expect(prisma.idea.findMany).not.toHaveBeenCalled();
  });

  it('paginates by descending timestamp and descending ID, not ID alone', async () => {
    const { prisma, service } = setup();
    prisma.idea.findMany.mockResolvedValueOnce([base, { ...base, id: OTHER_ID }]);
    const first = await service.listIdeas(USER, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.meta.next_cursor).toEqual(expect.any(String));
    expect(first.meta.next_cursor).not.toBe(ID);
    await service.listIdeas(USER, { cursor: first.meta.next_cursor!, q: 'Thought' } as any);
    expect(prisma.idea.findMany.mock.calls[1][0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({ userId: USER, AND: [{ OR: [
        { updatedAt: { lt: DATE } }, { updatedAt: DATE, id: { lt: ID } },
      ] }] }), orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    }));
  });

  it('retains the timestamp in the cursor even if its row is deleted or edited later', async () => {
    const { prisma, service } = setup();
    prisma.idea.findMany.mockResolvedValueOnce([base, { ...base, id: OTHER_ID }]);
    const page = await service.listIdeas(USER, { limit: 1 });
    prisma.idea.findFirst.mockResolvedValue(null);
    await service.listIdeas(USER, { cursor: page.meta.next_cursor! });
    expect(prisma.idea.findMany).toHaveBeenCalledTimes(2);
  });

  it('rejects a cursor belonging to a different account before listing rows', async () => {
    const { prisma, service } = setup();
    prisma.idea.findMany.mockResolvedValueOnce([base, { ...base, id: OTHER_ID }]);
    const first = await service.listIdeas(USER, { limit: 1 });
    prisma.idea.findMany.mockClear();
    await expect(service.listIdeas('other-user', { cursor: first.meta.next_cursor! })).rejects.toThrow(BadRequestException);
    expect(prisma.idea.findMany).not.toHaveBeenCalled();
  });

  it('continues to accept owned legacy UUID cursors using their timestamp', async () => {
    const { prisma, service } = setup();
    await service.listIdeas(USER, { cursor: ID });
    expect(prisma.idea.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ID, userId: USER } }));
    expect(prisma.idea.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: [{ OR: [
        { updatedAt: { lt: DATE } }, { updatedAt: DATE, id: { lt: ID } },
      ] }] }),
    }));
  });

  it('rejects legacy UUID cursors absent from the authenticated account', async () => {
    const { prisma, service } = setup();
    prisma.idea.findFirst.mockResolvedValue(null);
    await expect(service.listIdeas(USER, { cursor: OTHER_ID })).rejects.toThrow(NotFoundException);
    expect(prisma.idea.findMany).not.toHaveBeenCalled();
  });

  it('rejects malformed opaque cursors instead of silently restarting pagination', async () => {
    const { prisma, service } = setup();
    await expect(service.listIdeas(USER, { cursor: 'not-a-cursor' })).rejects.toThrow(BadRequestException);
    expect(prisma.idea.findMany).not.toHaveBeenCalled();
  });

  it('persists and clears review dates without resetting content on a review-only PATCH', async () => {
    const { prisma, service } = setup();
    const result = await service.updateIdea(USER, ID, { review_on: '2028-02-29' } as any);
    expect(prisma.idea.update).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: ID, userId: USER, status: 'ACTIVE' }),
      data: expect.objectContaining({ reviewOn: new Date('2028-02-29T00:00:00Z'), title: undefined, note: undefined }),
    }));
    expect(result).toHaveProperty('review_on', '2028-02-29');
    await service.updateIdea(USER, ID, { review_on: null } as any);
    expect(prisma.idea.update.mock.calls[1][0].data.reviewOn).toBeNull();
  });

  it('clears review on archive, and restores without resurrecting that review date', async () => {
    const { prisma, service } = setup();
    const archived = await service.updateIdea(USER, ID, { status: IdeaStatus.ARCHIVED, review_on: '2026-10-19' } as any);
    expect(archived).toEqual(expect.objectContaining({ status: 'ARCHIVED', review_on: null, archived_at: expect.any(String) }));
    prisma.idea.findFirst.mockResolvedValue({ ...base, status: IdeaStatus.ARCHIVED, reviewOn: null, archivedAt: DATE });
    const restored = await service.updateIdea(USER, ID, { status: IdeaStatus.ACTIVE });
    expect(restored).toEqual(expect.objectContaining({ status: 'ACTIVE', archived_at: null }));
    expect(prisma.idea.update.mock.calls[1][0].data.reviewOn).toBeUndefined();
  });

  it('does not allow PATCH to forge a CONVERTED status', async () => {
    const { prisma, service } = setup();
    await expect(service.updateIdea(USER, ID, { status: IdeaStatus.CONVERTED })).rejects.toThrow(BadRequestException);
    expect(prisma.idea.update).not.toHaveBeenCalled();
  });

  it('keeps converted ideas read-only, including review and archive patches', async () => {
    const { prisma, service } = setup();
    prisma.idea.findFirst.mockResolvedValue({ ...base, status: IdeaStatus.CONVERTED });
    await expect(service.updateIdea(USER, ID, { review_on: '2026-10-19' } as any)).rejects.toThrow(BadRequestException);
    expect(prisma.idea.update).not.toHaveBeenCalled();
  });

  it('clears review and archive metadata during conversion', async () => {
    const { prisma, service } = setup();
    await service.convertToTask(USER, ID, {});
    expect(prisma.idea.update).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: ID, userId: USER, status: 'ACTIVE' }),
      data: expect.objectContaining({ status: 'CONVERTED', convertedTaskId: 'task-1', reviewOn: null, archivedAt: null }),
    }));
  });

  it('deletes by authenticated owner without issuing a task deletion', async () => {
    const { prisma, service } = setup();
    await (service as any).deleteIdea(USER, ID);
    expect(prisma.idea.deleteMany).toHaveBeenCalledWith({ where: { id: ID, userId: USER } });
    expect(prisma.task.deleteMany).not.toHaveBeenCalled();
  });

  it('returns the same not-found result for missing and foreign deletions', async () => {
    const { prisma, service } = setup();
    prisma.idea.deleteMany.mockResolvedValue({ count: 0 });
    await expect((service as any).deleteIdea(USER, OTHER_ID)).rejects.toThrow(NotFoundException);
  });

  it('returns not-found for foreign updates before writing', async () => {
    const { prisma, service } = setup();
    prisma.idea.findFirst.mockResolvedValue(null);
    await expect(service.updateIdea(USER, OTHER_ID, { title: 'foreign' })).rejects.toThrow(NotFoundException);
    expect(prisma.idea.update).not.toHaveBeenCalled();
  });
  it('escapes SQL wildcards in literal search text', async () => {
    const { prisma, service } = setup();
    await service.listIdeas(USER, { q: '100%_done' });
    expect(prisma.idea.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [
        { title: { contains: '100\\%\\_done', mode: 'insensitive' } },
        { note: { contains: '100\\%\\_done', mode: 'insensitive' } },
      ] }),
    }));
  });

  it('keeps the task-to-idea deletion relation as SET NULL in the generated model', () => {
    const task = Prisma.dmmf.datamodel.models.find((model) => model.name === 'Task')!;
    expect(task.fields.find((field) => field.name === 'linkedIdea')?.relationOnDelete).toBe('SetNull');
  });

  it('does not silently mutate an idea converted between the ownership read and PATCH', async () => {
    const { prisma, service } = setup();
    prisma.idea.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Record changed', { code: 'P2025', clientVersion: '6.19.2' }));
    await expect(service.updateIdea(USER, ID, { review_on: '2026-10-19' } as any)).rejects.toThrow(BadRequestException);
    expect(prisma.idea.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ID, userId: USER, status: 'ACTIVE' } }));
  });

  it('rejects a conditional conversion conflict instead of reporting success', async () => {
    const { prisma, service } = setup();
    prisma.idea.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Record converted', { code: 'P2025', clientVersion: '6.19.2' }));
    await expect(service.convertToTask(USER, ID, {})).rejects.toThrow(BadRequestException);
    // Both writes must be inside the same transaction; PostgreSQL rolls it back on rejection.
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
    expect(prisma.idea.update).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: ID, userId: USER, status: 'ACTIVE' }) }));
  });

  it('guards the content revision when converting, so a stale snapshot cannot diverge from its task', async () => {
    const { prisma, service } = setup();
    await service.convertToTask(USER, ID, {});
    expect(prisma.idea.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ID, userId: USER, status: 'ACTIVE', updatedAt: DATE },
    }));
  });

});
