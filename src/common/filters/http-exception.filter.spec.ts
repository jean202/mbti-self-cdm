import {
  type ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { HttpExceptionFilter } from './http-exception.filter';

function capture(exception: unknown, url = '/v1/tasks') {
  const reply: {
    statusCode: number;
    body: unknown;
    status: (code: number) => typeof reply;
    send: (body: unknown) => typeof reply;
  } = {
    statusCode: 0,
    body: undefined,
    status: (code) => {
      reply.statusCode = code;
      return reply;
    },
    send: (body) => {
      reply.body = body;
      return reply;
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ url }),
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost;

  new HttpExceptionFilter().catch(exception, host);

  return {
    status: reply.statusCode,
    error: (reply.body as { error: Record<string, unknown> }).error,
  };
}

describe('HttpExceptionFilter', () => {
  it('wraps HttpExceptions in the error envelope with path and timestamp', () => {
    const { status, error } = capture(new NotFoundException('Task was not found.'), '/v1/tasks/1');

    expect(status).toBe(404);
    expect(error).toEqual({
      code: 'NOT_FOUND',
      message: 'Task was not found.',
      details: undefined,
      path: '/v1/tasks/1',
      timestamp: expect.any(String),
    });
    expect(new Date(error.timestamp as string).toISOString()).toBe(error.timestamp);
  });

  it.each([
    [new BadRequestException('x'), 400, 'VALIDATION_ERROR'],
    [new UnauthorizedException('x'), 401, 'UNAUTHORIZED'],
    [new ForbiddenException('x'), 403, 'FORBIDDEN'],
    [new ConflictException('x'), 409, 'CONFLICT'],
    [new HttpException('x', HttpStatus.TOO_MANY_REQUESTS), 429, 'INTERNAL_SERVER_ERROR'],
  ])('maps %p to %i %s', (exception, expectedStatus, expectedCode) => {
    const { status, error } = capture(exception);

    expect(status).toBe(expectedStatus);
    expect(error.code).toBe(expectedCode);
  });

  it('joins class-validator message arrays into one readable message', () => {
    const { error } = capture(
      new BadRequestException(['title should not be empty', 'source_type must be an enum']),
    );

    expect(error.message).toBe('title should not be empty, source_type must be an enum');
  });

  it('keeps a custom business code and details from the exception body', () => {
    const { status, error } = capture(
      new BadRequestException({
        code: 'INVALID_CALENDAR_OAUTH_STATE',
        message: 'Calendar OAuth state was not found or expired.',
        details: { flow_id: 'abc' },
      }),
    );

    expect(status).toBe(400);
    expect(error).toMatchObject({
      code: 'INVALID_CALENDAR_OAUTH_STATE',
      message: 'Calendar OAuth state was not found or expired.',
      details: { flow_id: 'abc' },
    });
  });

  it('uses a raw string response as the message', () => {
    const { error } = capture(new HttpException('Plain failure', HttpStatus.CONFLICT));

    expect(error).toMatchObject({ code: 'CONFLICT', message: 'Plain failure' });
  });

  it.each([
    ['P2002', 409, 'CONFLICT', 'Resource already exists.'],
    ['P2025', 404, 'NOT_FOUND', 'Resource was not found.'],
    ['P2003', 400, 'VALIDATION_ERROR', 'Invalid reference to related resource.'],
  ])('translates Prisma error %s', (code, expectedStatus, expectedCode, message) => {
    const prismaError = Object.assign(new Error('prisma internals'), { code });

    const { status, error } = capture(prismaError);

    expect(status).toBe(expectedStatus);
    expect(error).toMatchObject({ code: expectedCode, message });
  });

  it('hides the message of unexpected errors', () => {
    const { status, error } = capture(
      new Error('connect ECONNREFUSED 10.0.0.5:5432 password=secret'),
    );

    expect(status).toBe(500);
    expect(error).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Unexpected server error.',
    });
    expect(JSON.stringify(error)).not.toContain('secret');
  });

  it('treats unknown Prisma codes and non-error throwables as unexpected', () => {
    expect(capture(Object.assign(new Error('x'), { code: 'P2034' })).status).toBe(500);
    expect(capture('a string was thrown').status).toBe(500);
    expect(capture(null).status).toBe(500);
  });
});
