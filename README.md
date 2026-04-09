# mbti-self-cdm

MBTI/인지기능 기반의 자기관리 및 시간관리 앱을 목표로 한 프로젝트입니다. 현재는 모바일 앱과 분리된 백엔드 서버를 중심으로 구조와 문서를 먼저 정리하고 있습니다.

## 상태

- 현재 상태: 진행 중
- 방향: 문서화와 구조 정리를 먼저 진행한 뒤 구현을 확장
- 백엔드: Node.js + TypeScript + NestJS + Fastify
- 클라이언트 계획: Flutter

## 이 저장소에서 바로 볼 수 있는 것

- 인증, 프로필, 개인화 방향이 담긴 제품 결정 사항
- API 명세와 화면 스펙
- 기술 스택 선택 문서
- 백엔드 구현을 위한 초기 코드와 실행 스크립트

## 주요 문서

- `docs/api-contract.md`
- `docs/mvp-screen-spec.md`
- `docs/technical-stack-decision.md`
- `docs/backend-implementation-plan.md`
- `docs/db-schema.md`
- `docs/type-profile-data-model.md`
- `docs/auth-login-integration.md`

문서 개요는 `docs/README.md`에서 한 번에 볼 수 있습니다.

## 현재 코드 기준

- `src/`: NestJS 기반 서버 진입점
- `package.json`: 빌드, 검증, 인프라 실행 스크립트
- `docs/`: API, 화면, 데이터 모델, 기술 결정 문서

## 로컬 실행

필수 조건:

- Node.js + npm
- Docker Desktop 또는 Docker Engine

처음 시작하거나 기존 로컬 DB 상태를 버리고 다시 맞출 때:

```bash
npm install
npm run bootstrap:local:clean
```

기존 로컬 DB/Redis 볼륨을 유지한 채 다시 맞출 때:

```bash
npm run bootstrap:local
```

이 스크립트는 다음 순서로 실행됩니다.

- `.env`가 없으면 `.env.example`을 복사
- `postgres`, `redis`를 `docker compose up -d --wait`로 기동
- Prisma Client 생성
- Prisma migration 적용
- 데모 데이터 시드

통합 검증:

```bash
npm run verify:local
```

깨끗한 상태에서 인프라 초기화와 검증을 한 번에 다시 돌릴 때:

```bash
npm run verify:local:clean
```

앱 서버 개발 실행:

```bash
npm run start:dev
```

참고:

- `bootstrap:local:clean`, `verify:local:clean`은 Docker 볼륨을 삭제하므로 로컬 Postgres/Redis 데이터가 초기화됩니다.
- 예전 로컬 DB가 migration history 없이 남아 있으면 `bootstrap:local` 대신 `bootstrap:local:clean`을 써야 합니다.

## 메모

이 저장소는 아직 정리 중인 프로젝트입니다. 다만 설계에서 구현으로 이어지는 과정을 보여주는 용도로 문서와 구조를 우선 공개합니다.
