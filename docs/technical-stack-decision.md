# 기술 스택 결정

마지막 업데이트: 2026-03-26

기준 문서:

- [agent.md](/Users/admin/IdeaProjects/mbti-self-cdm/agent.md)
- [mvp-screen-spec.md](/Users/admin/IdeaProjects/mbti-self-cdm/docs/mvp-screen-spec.md)

## 1. 확정된 결정

- 모바일 클라이언트: Flutter
- 서버 구조: 별도 API 서버 운영
- 백엔드 런타임/언어: Node.js + TypeScript
- 백엔드 프레임워크: NestJS + Fastify adapter
- 관계형 DB: PostgreSQL
- ORM / DB toolkit: Prisma
- background job / queue: BullMQ
- 캐시 / 세션 / lock: Redis
- 인증 흐름: 소셜 로그인 -> 백엔드 JWT/refresh token 발급
- 세션 관리: Redis 기반 JWT/session 관리
- 캘린더 연동: 백엔드 중심의 읽기 전용 동기화

## 2. 아키텍처 방향

기본 구조:

- Flutter 앱은 UI, 로컬 상태, 네이티브 로그인 진입을 담당한다
- API 서버는 NestJS 모듈 구조로 인증, MBTI personalization, Task/Idea/Reflect 도메인 로직, 캘린더 연동을 담당한다
- PostgreSQL은 영속 데이터의 기준 저장소가 된다
- Prisma는 DB schema, migration, query 계층을 담당한다
- Redis는 세션, 단기 상태, lock, queue backend로 사용한다
- BullMQ는 캘린더 sync와 후속 background job 처리에 사용한다

간단한 책임 분리:

- Flutter:
  - 화면 렌더링
  - 입력 처리
  - 인증 시작/복귀 처리
  - API 응답 표시
- API 서버:
  - provider 토큰 교환
  - JWT/refresh token 발급 및 검증
  - MBTI profile 기반 personalization 계산
  - 캘린더 연결 및 동기화
  - 내부 도메인 모델 저장
  - BullMQ job enqueue
  - Prisma를 통한 PostgreSQL 접근

## 2.1 NestJS를 선택한 이유

- 인증, onboarding, personalization, calendar sync처럼 모듈 수가 많은 구조에서 기본 아키텍처가 잘 잡힌다
- `Guard`, `Interceptor`, `Module`, `Provider` 패턴으로 API 계층을 일관되게 분리하기 쉽다
- Fastify adapter를 붙이면 NestJS의 구조를 유지하면서도 성능 오버헤드를 줄일 수 있다
- Prisma, Redis, BullMQ 조합과의 궁합이 좋다

## 2.2 Fastify adapter를 쓰는 이유

- NestJS 기본 HTTP adapter보다 더 가볍고 빠른 런타임 구성이 가능하다
- 현재 프로젝트는 대량의 템플릿 렌더링보다 JSON API가 중심이므로 Fastify 쪽이 더 적합하다
- NestJS 생태계를 포기하지 않고도 HTTP 레이어의 비용을 줄일 수 있다

## 2.3 Prisma를 쓰는 이유

- 현재 [db-schema.md](/Users/admin/IdeaProjects/mbti-self-cdm/docs/db-schema.md) 수준의 논리 스키마를 실제 schema와 migration으로 옮기기 쉽다
- TypeScript에서 타입 안전한 query 작성이 가능하다
- `users`, `mbti_profiles`, `tasks`, `calendar_events`처럼 관계형 엔티티가 많은 구조와 잘 맞는다

## 2.4 BullMQ를 쓰는 이유

- Redis 기반이라 현재 세션/lock 인프라와 자연스럽게 맞물린다
- 캘린더 read sync, 재시도, backoff, queue 상태 관리를 붙이기 쉽다
- `POST /v1/calendar/connections/{connection_id}/sync` 같은 API를 즉시 응답 + 비동기 처리 모델로 구현하기 좋다

## 3. Redis 기반 JWT/세션 전략

`JWT를 Redis에 보관`한다는 요구는 아래처럼 운영 가능한 구조로 해석한다.

- access token:
  - 짧은 수명으로 발급한다
  - token 자체를 영구 저장하기보다 `jti` 또는 session key를 Redis에서 조회 가능하게 둔다
- refresh token:
  - Redis에서 현재 유효 토큰 family와 회전 상태를 관리한다
  - 로그아웃 또는 이상 징후 발생 시 즉시 폐기 가능해야 한다
- device/session:
  - 사용자별 활성 세션 메타데이터를 Redis에 둔다
  - TTL 기반 만료와 강제 로그아웃을 쉽게 처리할 수 있어야 한다

권장 Redis 사용 범위:

- refresh token family
- access token revocation / blacklist
- 활성 세션 조회
- OAuth `state` / `nonce` 같은 단기 인증 상태
- 캘린더 동기화 lock

Redis에 두지 않는 것:

- 장기 보관이 필요한 provider credential
- 영속 도메인 데이터
- 사용자 핵심 프로필

## 4. 캘린더 연동 방식

MVP에서는 `백엔드 중심 read-focused sync`를 채택한다.

핵심 원칙:

- Flutter 앱은 캘린더 연결 시작과 결과 표시만 담당한다
- provider 연결 후 실제 credential 보관과 동기화는 API 서버가 담당한다
- 외부 캘린더 이벤트는 내부 `CalendarEvent`로 정규화해서 앱이 읽는다
- MVP에서는 외부 캘린더에 쓰기(write-back)하지 않는다

이 방식을 택하는 이유:

- provider별 API 차이를 Flutter 앱에 퍼뜨리지 않기 위해서
- 캘린더 이벤트를 `Plan`, `Home`, `Reflect`에서 일관된 형식으로 사용하기 위해서
- 동기화 실패, 재시도, rate limit, token 갱신을 서버에서 통제하기 위해서

연동 흐름:

1. 사용자가 Flutter 앱에서 캘린더 연결 시작
2. API 서버가 provider OAuth 연결을 처리
3. 서버가 provider credential을 안전하게 저장
4. 서버가 외부 이벤트를 읽어 내부 `CalendarEvent`로 동기화
5. Flutter 앱은 내부 API로 정규화된 캘린더 데이터를 조회

## 5. 지금 열어둘 수 있는 미결정 항목

아직 확정하지 않아도 되는 것:

- secret storage 구현체
- observability stack
- deployment topology

이 항목들은 지금 당장 고정하지 않아도 되지만, 아래 전제는 유지한다.

- PostgreSQL 중심 스키마를 쓴다
- NestJS + Fastify adapter를 기준으로 구현한다
- Prisma로 migration과 DB access를 관리한다
- Redis를 세션/단기 상태에 사용한다
- BullMQ로 background job을 처리한다
- 캘린더는 서버가 소유한다

## 6. 현 상태에서 바로 만들 수 있는 다음 산출물

이 결정과 현재 전제만으로도 바로 만들 수 있는 산출물은 다음과 같다.

1. NestJS 백엔드 구현 계획
2. Prisma schema / initial migration 설계
3. module skeleton 및 first vertical slice 구현 계획

단, 이 산출물들은 구현 전 단계의 논리 설계 기준이다.

- 실제 서버 코드 작성
- DB migration 작성
- background job 구현
- provider credential 저장 구현

위 단계로 넘어가기 전에는 5번의 미결정 항목 중 최소한 아래는 확정해야 한다.

- secret storage 구현체
