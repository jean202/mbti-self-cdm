import { ConsoleLogger, Injectable } from '@nestjs/common';
import { requestContext } from './request-context';

@Injectable()
export class AppLogger extends ConsoleLogger {
  protected formatMessage(
    logLevel: 'log' | 'fatal' | 'error' | 'warn' | 'debug' | 'verbose',
    message: unknown,
    pidMessage: string,
    formattedLogLevel: string,
    contextMessage: string,
    timestampDiff: string,
  ): string {
    const store = requestContext.getStore();
    
    // RequestContext에 CID가 있다면 메시지 앞에 부착
    if (store?.correlationId) {
      message = `[CID: ${store.correlationId}] ${message}`;
    }

    // 기존 NestJS 로거의 색상 및 포맷팅 엔진을 그대로 사용
    return super.formatMessage(logLevel, message, pidMessage, formattedLogLevel, contextMessage, timestampDiff);
  }
}