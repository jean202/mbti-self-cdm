import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  app.setGlobalPrefix('v1');
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  });

  const swaggerDescription = `MBTI 기반 자기관리 앱 백엔드 API

### 📚 API Error Code Catalog
앱 전반에서 공통으로 발생할 수 있는 주요 HTTP 상태 코드 및 비즈니스 에러 코드 가이드입니다.

| HTTP Status | Message / Code | 설명 |
|---|---|---|
| **400** Bad Request | \`Validation Error\` | 요청 파라미터 오류 (필수 값 누락, 타입 불일치 등) |
| **400** Bad Request | \`INVALID_CALENDAR_OAUTH_STATE\` | 캘린더 OAuth 인증 상태가 만료되었거나 유효하지 않음 |
| **400** Bad Request | \`CALENDAR_OAUTH_DENIED\` | 사용자가 캘린더 연동 권한 제공을 거부함 |
| **401** Unauthorized | \`Session is invalid.\` | 인증 토큰(Access Token)이 없거나 세션이 만료됨 (재로그인 필요) |
| **401** Unauthorized | \`Refresh token is invalid.\` | Refresh Token이 만료되었거나 변조/회전(Rotation) 규칙 위반 |
| **404** Not Found | \`*** was not found.\` | 요청한 리소스(유저, 태스크, 세션 등)를 DB에서 찾을 수 없음 |
| **409** Conflict | \`Conflict\` (Prisma P2002) | 리소스 충돌 (이미 존재하는 데이터 생성 시도 등) |
| **409** Conflict | \`CALENDAR_ONBOARDING_NOT_READY\` | MBTI 온보딩을 완료하기 전에 캘린더 연동을 시도함 |
| **500** Server Error | \`TOKEN_EXCHANGE_FAILED\` | 외부 API(구글 등)와의 토큰 교환/통신 실패 |`;

  const swaggerConfig = new DocumentBuilder()
    .setTitle('MBTI Self-CDM API')
    .setDescription(swaggerDescription)
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    useGlobalPrefix: false,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? '3000');
  // Railway/컨테이너 환경에서는 0.0.0.0 으로 바인딩해야 외부 트래픽을 받을 수 있다.
  // 로컬 개발 시에는 HOST=127.0.0.1 로 재정의한다.
  const host = process.env.HOST ?? '0.0.0.0';

  await app.listen(port, host);
}

void bootstrap();
