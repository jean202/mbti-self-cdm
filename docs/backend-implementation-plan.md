# NestJS 백엔드 구현 계획

마지막 업데이트: 2026-03-26

기준 문서:

- [technical-stack-decision.md](/Users/admin/IdeaProjects/mbti-self-cdm/docs/technical-stack-decision.md)
- [api-contract.md](/Users/admin/IdeaProjects/mbti-self-cdm/docs/api-contract.md)
- [db-schema.md](/Users/admin/IdeaProjects/mbti-self-cdm/docs/db-schema.md)
- [type-profile-data-model.md](/Users/admin/IdeaProjects/mbti-self-cdm/docs/type-profile-data-model.md)

## 1. 목표

- `NestJS + Fastify adapter + PostgreSQL + Prisma + Redis + BullMQ`를 기준으로 서버 구현 순서를 고정한다
- Flutter 앱이 가장 먼저 붙을 수 있는 `first vertical slice`를 정의한다
- 모듈 경계와 구현 우선순위를 미리 정해서 중간에 구조가 흔들리지 않게 한다

## 2. 최종 백엔드 스택

- Runtime: Node.js
- Language: TypeScript
- Framework: NestJS
- HTTP adapter: Fastify
- Database: PostgreSQL
- ORM / DB toolkit: Prisma
- Cache / session / lock: Redis
- Queue / worker: BullMQ

## 3. 기본 아키텍처

권장 앱 구성:

- API app
  - 인증, onboarding, 도메인 API 응답
- Worker app
  - calendar sync
  - reminder / future background jobs

공용 인프라:

- PostgreSQL
- Redis

공용 데이터 소스:

- `Prisma schema`
- `data/type-profiles/`

## 4. NestJS 모듈 구조

권장 모듈:

- `app`
- `config`
- `health`
- `auth`
- `session`
- `users`
- `mbti`
- `type-profiles`
- `home`
- `plan`
- `tasks`
- `ideas`
- `reflect`
- `calendar`
- `me`
- `queue`
- `prisma`
- `redis`

역할 요약:

- `auth`
  - social login token exchange
  - access / refresh token 발급
  - logout
- `session`
  - Redis session lookup
  - refresh family rotation
  - revocation
- `mbti`
  - type catalog
  - finder attempts / answers / completion
  - profile confirm / patch
- `type-profiles`
  - JSON loader
  - profile validation
  - locale / version resolution
- `home`
  - personalized home payload assembly
- `plan`
  - today / week / backlog payload assembly
- `tasks`
  - CRUD / reorder / complete / reschedule
- `ideas`
  - CRUD / convert to task
- `reflect`
  - mood-energy checks
  - daily reflect payload
  - reflections upsert
- `calendar`
  - connection state
  - normalized event query
  - sync enqueue
- `queue`
  - BullMQ queue / worker bootstrap

## 5. 공용 계층

공용 provider:

- `PrismaService`
- `RedisService`
- `TypeProfileLoaderService`
- `ClockService`
- `IdempotencyService`

공용 HTTP 계층:

- `AuthGuard`
- `CurrentUser` decorator
- `RequestContext` provider
- global validation pipe
- global exception filter
- response interceptor

## 6. 추천 폴더 구조

```text
src/
  main.ts
  app.module.ts
  common/
    auth/
    decorators/
    filters/
    interceptors/
    pipes/
    types/
  config/
  infra/
    prisma/
    redis/
    queue/
  modules/
    auth/
    session/
    users/
    mbti/
    type-profiles/
    home/
    plan/
    tasks/
    ideas/
    reflect/
    calendar/
    me/
prisma/
  schema.prisma
data/
  type-profiles/
```

## 7. 구현 우선순위

### Phase 1. 서버 뼈대

목표:

- NestJS app 부트스트랩
- Fastify adapter 연결
- Prisma / Redis 연결
- config 체계와 health endpoint 구성

완료 기준:

- 서버가 뜬다
- PostgreSQL / Redis 연결 확인 가능
- 기본 에러 포맷과 validation이 붙는다

### Phase 2. 인증 / 세션

목표:

- `POST /v1/auth/social/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `GET /v1/app/bootstrap`

핵심 구현:

- provider payload 검증
- JWT 발급
- Redis session 저장
- refresh family rotation

완료 기준:

- Flutter가 세션 생성, refresh, bootstrap을 할 수 있다

### Phase 3. type-profile loader

목표:

- `data/type-profiles/2026-03-v1/*.json` 로더 구현
- `type_code + profile_version + locale` 기준 조회
- 캐시 전략 추가

완료 기준:

- Home / Reflect 조합 로직이 profile 데이터를 읽을 수 있다

### Phase 4. first vertical slice

목표:

- `GET /v1/app/bootstrap`
- `GET /v1/home`
- `PUT /v1/today-focus`

핵심 구현:

- user / mbti profile 조회
- type-profile 기반 personalized home payload 조립
- today focus 생성/수정

완료 기준:

- 로그인된 사용자가 personalized home을 볼 수 있다

### Phase 5. onboarding / task / idea / reflect

목표:

- MBTI onboarding API
- Task / Idea CRUD
- Reflect API

완료 기준:

- onboarding -> home -> quick capture -> reflect 일일 루프가 API 수준에서 연결된다

### Phase 6. calendar connection / sync

목표:

- connection 조회 / revoke
- sync enqueue
- normalized calendar events query
- BullMQ worker 기반 read sync

완료 기준:

- 서버가 calendar sync를 소유하고 Home / Plan에 이벤트를 공급한다

## 8. First Vertical Slice 상세

가장 먼저 붙일 API:

1. `POST /v1/auth/refresh`
2. `GET /v1/app/bootstrap`
3. `GET /v1/home`
4. `PUT /v1/today-focus`

이 조합을 먼저 추천하는 이유:

- Flutter 앱이 로그인 후 다시 열릴 때 필요한 최소 루프를 만든다
- type-profile loader가 실제 payload 생성에 쓰이는지 바로 검증할 수 있다
- 개인화 구조가 generic API로 퇴화하지 않는지 초기에 확인 가능하다

## 9. Prisma 우선 모델

가장 먼저 Prisma로 옮길 모델:

- `users`
- `auth_identities`
- `mbti_profiles`
- `today_focuses`
- `tasks`

그 다음 모델:

- `ideas`
- `mood_energy_checks`
- `reflections`
- `calendar_connections`
- `calendar_events`
- `mbti_finder_attempts`
- `mbti_finder_answers`

## 10. BullMQ 우선 큐

초기 큐 이름 권장:

- `calendar-sync`
- `calendar-refresh-token`

후속 큐 후보:

- `reminder-dispatch`
- `analytics-fanout`

## 11. 남은 기술 결정

구현 시작 전 또는 직후 빠르게 정해야 할 것:

- secret storage 구현체
- environment 분리 방식
- observability stack
- deployment 방식

이 항목들은 아직 열어둘 수 있지만, `calendar credential 저장`과 `worker 운영` 전에 확정하는 편이 좋다

## 12. 다음 바로 할 일

이 문서 다음으로 가장 자연스러운 작업:

1. `prisma/schema.prisma` 초안 작성
2. NestJS module skeleton 설계
3. `type profile loader` 인터페이스 정의
