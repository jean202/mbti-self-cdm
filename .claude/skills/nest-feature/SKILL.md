---
name: nest-feature
description: MBTI 앱에 새 기능을 추가한다. NestJS + Fastify + Prisma 백엔드 패턴.
argument-hint: "[기능 설명 - 예: 인지기능 분석 API]"
---

## NestJS 기능 추가 워크플로우

대상: **$ARGUMENTS**

### 프로젝트 정보
- NestJS + Fastify + TypeScript
- Prisma ORM + PostgreSQL
- Redis (캐싱/세션)
- Flutter 클라이언트 예정

### 구현 순서
1. **Prisma 스키마** — `prisma/schema.prisma`에 모델 추가 → `npx prisma migrate dev`
2. **Module** — NestJS 모듈 생성 (`nest g module [name]`)
3. **DTO** — Request/Response DTO + class-validator 검증
4. **Service** — 비즈니스 로직 (Prisma Client 주입)
5. **Controller** — REST 엔드포인트
6. **테스트** — unit + e2e 테스트

### 참고
- `docs/` 폴더에 API 계약서, 화면 스펙 문서 있음
- 현재 설계/문서화 단계 — 백엔드 스캐폴딩 진행 중
