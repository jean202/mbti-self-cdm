import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { requestContext } from './request-context';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    const correlationId = req.headers['x-correlation-id'] || randomUUID();
    
    if (res.setHeader) {
      res.setHeader('x-correlation-id', correlationId);
    }

    // 이 블록(콜백) 안에서 실행되는 모든 코드(컨트롤러, 서비스 등)는 동일한 CID를 공유함
    requestContext.run({ correlationId }, () => next());
  }
}