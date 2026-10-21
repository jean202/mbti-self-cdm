import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '../../common/auth/auth.guard';
import { AuthTokenService } from '../auth/auth-token.service';
import { SessionService } from '../session/session.service';
import { IdeasController } from './ideas.controller';
import { IdeasService } from './ideas.service';

const ID = '2187af27-aa48-4195-9335-1a62b160ffb2';
describe('Thought inbox HTTP ownership and validation', () => {
  let app: NestFastifyApplication;
  const service = { deleteIdea: jest.fn(), updateIdea: jest.fn(), listIdeas: jest.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [IdeasController], providers: [
        AuthGuard,
        { provide: IdeasService, useValue: service },
        { provide: AuthTokenService, useValue: { verifyAccessToken: () => ({ sub: 'user-1', sid: 'session-1' }) } },
        { provide: SessionService, useValue: { validateAccessSession: async () => ({ deviceId: 'test-device' }) } },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => app.close());
  const headers = { authorization: 'Bearer local-test-token' };

  it('requires authentication for DELETE', async () => {
    const response = await app.inject({ method: 'DELETE', url: `/v1/ideas/${ID}` });
    expect(response.statusCode).toBe(401);
    expect(service.deleteIdea).not.toHaveBeenCalled();
  });
  it('uses the authenticated owner for DELETE, ignoring a forged query user', async () => {
    service.deleteIdea.mockResolvedValue({ id: ID });
    const response = await app.inject({ method: 'DELETE', url: `/v1/ideas/${ID}?user_id=other-user`, headers });
    expect(response.statusCode).toBe(200);
    expect(service.deleteIdea).toHaveBeenCalledWith('user-1', ID);
  });
  it('rejects a malformed UUID before deleting', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/v1/ideas/not-a-uuid', headers });
    expect(response.statusCode).toBe(400);
    expect(service.deleteIdea).not.toHaveBeenCalled();
  });
  it('keeps search and date-only filters through the HTTP validation pipe', async () => {
    service.listIdeas.mockResolvedValue({ items: [], meta: { next_cursor: null } });
    const response = await app.inject({ method: 'GET', url: '/v1/ideas?q=old%20body&review_before=2026-10-18&limit=5', headers });
    expect(response.statusCode).toBe(200);
    expect(service.listIdeas).toHaveBeenCalledWith('user-1', expect.objectContaining({ q: 'old body', review_before: '2026-10-18', limit: 5 }));
  });
  it('rejects an impossible review date before updating', async () => {
    const response = await app.inject({ method: 'PATCH', url: `/v1/ideas/${ID}`, headers, payload: { review_on: '2026-02-30' } });
    expect(response.statusCode).toBe(400);
    expect(service.updateIdea).not.toHaveBeenCalled();
  });
});
