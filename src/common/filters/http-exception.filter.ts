import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

type ErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    path: string;
    timestamp: string;
  };
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const response = ctx.getResponse<FastifyReply>();

    const error = this.normalizeException(exception);

    response.status(error.status).send({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        path: request.url,
        timestamp: new Date().toISOString(),
      },
    } satisfies ErrorBody);
  }

  private normalizeException(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    if (!(exception instanceof HttpException)) {
      const prismaError = this.tryParsePrismaError(exception);
      if (prismaError) {
        return prismaError;
      }

      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unexpected server error.',
      };
    }

    const status = exception.getStatus();
    const response = exception.getResponse();

    if (typeof response === 'string') {
      return {
        status,
        code: this.statusToCode(status),
        message: response,
      };
    }

    if (typeof response === 'object' && response !== null) {
      const responseBody = response as Record<string, unknown>;
      const message = this.readMessage(responseBody.message);
      const code =
        typeof responseBody.code === 'string'
          ? responseBody.code
          : this.statusToCode(status);

      return {
        status,
        code,
        message,
        details: responseBody.details,
      };
    }

    return {
      status,
      code: this.statusToCode(status),
      message: exception.message,
    };
  }

  private readMessage(message: unknown): string {
    if (Array.isArray(message)) {
      return message.map((item) => String(item)).join(', ');
    }

    if (typeof message === 'string') {
      return message;
    }

    return 'Request failed.';
  }

  private tryParsePrismaError(
    exception: unknown,
  ): { status: number; code: string; message: string } | null {
    if (
      typeof exception !== 'object' ||
      exception === null ||
      !('code' in exception)
    ) {
      return null;
    }

    const prismaCode = (exception as { code: string }).code;

    switch (prismaCode) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          code: 'CONFLICT',
          message: 'Resource already exists.',
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'Resource was not found.',
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          code: 'VALIDATION_ERROR',
          message: 'Invalid reference to related resource.',
        };
      default:
        return null;
    }
  }

  private statusToCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_ERROR';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      default:
        return 'INTERNAL_SERVER_ERROR';
    }
  }
}
