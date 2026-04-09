# 작업 로그: 2026-04-09

## 요약

백엔드 API를 **미완성 → 전체 구현 + 검증 + 테스트 + 품질 개선**까지 완료했다.
커밋 12건, 파일 59개 변경, +11,379줄.

---

## 1. 미커밋 작업 정리 및 커밋

### 무엇을 했는가

이전 세션에서 작업했지만 커밋되지 않은 변경분을 3개 커밋으로 분리해서 정리했다.

### 커밋

- `b15f762` — MBTI 모듈 서비스·DTO·Finder 로직 구현
- `6676196` — Calendar 모듈 OAuth 흐름·DTO·내부 콜백 구현
- `0050872` — 검증 스크립트·시드 데이터·README 업데이트

### 핵심 파일

- `src/modules/mbti/mbti.service.ts` — 타입 카탈로그, 자기선택, Finder 테스트(질문 로드·답변 저장·채점) 전체 흐름
- `src/modules/mbti/mbti-finder-scoring.service.ts` — EI/SN/TF/JP 축별 점수 계산, 인지 스택 매핑, 신뢰도 산출
- `src/modules/mbti/mbti-finder-question-set.service.ts` — JSON 질문 세트 로더
- `src/modules/calendar/calendar.service.ts` — OAuth 시작(state→Redis), 콜백 처리, 연결 관리, 이벤트 조회
- `src/modules/calendar/internal-calendar-oauth.controller.ts` — 서버 간 OAuth 콜백 엔드포인트
- `data/mbti-finder-question-sets/2026-03-v1.json` — 28문항 질문 데이터

### 공부 포인트

- MBTI Finder 채점 로직: `mbti-finder-scoring.service.ts`의 `scoreAttempt()` 메서드를 읽으면 축별 점수 → 4글자 코드 → 인지 스택 매핑 흐름을 이해할 수 있다
- Calendar OAuth: Redis에 state를 저장하고, 콜백에서 검증 후 삭제하는 패턴. `startOAuth()` → `completeOAuthCallback()` 흐름 참고

---

## 2. 누락 엔드포인트 추가

### 무엇을 했는가

API 컨트랙트에 정의되어 있지만 구현이 빠져있던 Tasks 액션 엔드포인트 2개를 추가했다.

### 커밋

- `15b4bf0` — Tasks 모듈에 complete/reschedule 액션 엔드포인트 추가

### 핵심 파일

- `src/modules/tasks/tasks.service.ts` — `completeTask()`, `rescheduleTask()` 메서드
- `src/modules/tasks/dto/reschedule-task.dto.ts` — due_at + local_due_date 입력

### 공부 포인트

- `completeTask()`는 기존 `completedAt`이 있으면 유지하고, 없으면 현재 시간을 설정 (멱등성)
- `rescheduleTask()`에서 `local_due_date`를 명시적으로 받을 수도 있고, `due_at`에서 타임존 변환으로 자동 계산할 수도 있다

---

## 3. 테스트 인프라 구축 + 단위 테스트 작성

### 무엇을 했는가

Jest를 설정하고 핵심 서비스 6개에 대해 47개 단위 테스트를 작성했다.

### 커밋

- `5a9ce0b` — Jest 설정 + local-date util, CaptureService, TasksService 테스트 (24건)
- `a9e4e02` — HomeService, IdeasService, ReflectService 테스트 추가 (23건)

### 핵심 파일

- `jest.config.ts` — ts-jest 설정
- `src/common/utils/local-date.util.spec.ts` — 날짜 파싱/포맷/범위 유틸 테스트
- `src/modules/capture/capture.service.spec.ts` — 키워드 분류, 타입 바이어스, 캡처 힌트
- `src/modules/tasks/tasks.service.spec.ts` — CRUD, complete, reschedule, 페이지네이션
- `src/modules/home/home.service.spec.ts` — 개인화 홈 피드, TodayFocus, MBTI 없는 경우
- `src/modules/ideas/ideas.service.spec.ts` — CRUD, 변환, CONVERTED 업데이트 차단
- `src/modules/reflect/reflect.service.spec.ts` — 일일 회고, 무드/에너지, 중복 방지

### 공부 포인트

- PrismaService를 mock하는 패턴: `createMockPrisma()` 헬퍼로 `jest.fn().mockResolvedValue()`를 사용
- NestJS 서비스는 constructor injection이므로 mock 객체를 직접 넘겨서 `new Service(mockPrisma)` 형태로 테스트 가능
- `tsconfig.json`에 `"types": ["node", "jest"]` 추가가 필요했음

---

## 4. Calendar BullMQ 워커 구현

### 무엇을 했는가

`calendar-sync` 큐를 소비하는 BullMQ Worker를 만들었다. Provider Adapter 패턴으로 설계해서 Google Calendar API를 나중에 쉽게 연결할 수 있게 했다.

### 커밋

- `aa6a065` — Calendar BullMQ sync 워커 구현

### 핵심 파일

- `src/modules/calendar/calendar-sync.worker.ts` — 전체 워커 로직

### 아키텍처

```
CalendarService.syncConnection()
  → queue.add('sync-connection', { connection_id, user_id, provider })
  → CalendarSyncWorker.processJob()
    → getProviderAdapter(provider)  // GOOGLE → stub (dev) or real adapter
    → adapter.fetchEvents(credentialsRef, syncCursor)
    → upsertEvents()  // Prisma upsert (providerEventId 기준)
    → connection.status = ACTIVE, lastSyncedAt = now
```

### 공부 포인트

- `CalendarProviderAdapter` 인터페이스: `fetchEvents(credentialsRef, syncCursor) → {events, next_sync_cursor}`
- dev bridge 모드에서는 stub adapter가 빈 배열을 반환
- concurrency: 3, rate limit: 10/분으로 설정
- `onModuleInit()`에서 워커 시작, `onModuleDestroy()`에서 정리 (NestJS 라이프사이클)

---

## 5. 로컬 검증 (전체 통과)

### 무엇을 했는가

Docker(Postgres + Redis)를 띄우고 검증 스크립트 6개를 전부 실행해서 통과를 확인했다.

### 검증 결과

| 스크립트 | 검증 내용 |
|---------|----------|
| verify-auth-flow | 로그인 → JWT 발급 → bootstrap → refresh → logout |
| verify-mbti-onboarding | 카탈로그(16종) → 자기선택 → Finder(28문항) → 채점(INFJ, 0.87) → 확정 |
| verify-calendar-oauth-start | OAuth 시작 → authorize URL 생성 → Redis state 저장 |
| verify-calendar-oauth-callback | 콜백 성공(연결 생성) + 실패(거부) 시나리오 |
| verify-calendar-flow | 연결 조회 → sync 큐 enqueue → 이벤트 조회 → revoke |
| verify-vertical-slice | bootstrap → home(개인화 프롬프트, 카드) → today focus upsert |

### 공부 포인트

- 각 스크립트는 `scripts/` 폴더에 있고 `npm run verify:*`로 실행 가능
- 스크립트들은 빌드된 dist/ 코드를 직접 import해서 서비스 레이어를 호출

---

## 6. Swagger/OpenAPI 문서 자동 생성

### 무엇을 했는가

`@nestjs/swagger`를 연동해서 42개 엔드포인트의 대화형 API 문서를 자동 생성했다.

### 커밋

- `e8a6d74` — Swagger 설정 + 전체 컨트롤러에 ApiTags/ApiBearerAuth 데코레이터
- `8405405` — OpenAPI 스펙 JSON 내보내기 스크립트 + Flutter 구현 계획

### 핵심 파일

- `src/main.ts` — `DocumentBuilder` + `SwaggerModule.setup('docs', ...)`
- `scripts/export-openapi.js` — `npm run export:openapi`로 docs/openapi.json 생성
- `docs/openapi.json` — 42개 엔드포인트의 OpenAPI 3.0 스펙
- `docs/flutter-implementation-plan.md` — Flutter 프로젝트 구조·기술 스택·구현 우선순위

### 사용법

```bash
npm run start:dev
# 브라우저에서 http://localhost:3000/docs 접속
```

### 공부 포인트

- Fastify 어댑터에서는 `@fastify/static` 패키지가 필요
- 글로벌 프리픽스 `/v1`이 있을 때 Swagger는 별도 경로(`/docs`)에 마운트 → `useGlobalPrefix: false` 옵션 사용
- 각 컨트롤러에 `@ApiTags('이름')`, `@ApiBearerAuth()` 붙이면 Swagger UI에서 태그별 분류 + 인증 토큰 입력 가능

---

## 7. API 컨트랙트 vs 구현 갭 분석 + 수정

### 무엇을 했는가

API 컨트랙트 문서와 실제 코드를 비교해서 10건의 불일치를 발견하고 전부 수정했다.

### 커밋

- `9e19a2a` — API 컨트랙트-구현 갭 수정
- `4640dc8` — OpenAPI 스펙 재생성

### 수정 내용

| 갭 | 조치 |
|----|------|
| Ideas에 커서 페이지네이션 없음 | 코드 수정: `{items, meta: {next_cursor}}` 구조로 변경 |
| Tasks에 커서 페이지네이션 미작동 | 코드 수정: cursor 파라미터 실제 적용 |
| Home에 `trajectory_gap_card` 필드 누락 | 코드 수정: `null`로 명시 (MVP 후 구현) |
| Capture 응답에 `capture_hints` 미문서화 | 컨트랙트 업데이트 |
| Reflect에 `existing_reflection_id` 미문서화 | 컨트랙트 업데이트 |
| Reflect에 `already_submitted` 미문서화 | 컨트랙트 업데이트 |

### 공부 포인트

- 커서 페이지네이션 패턴: `take: limit + 1` → 결과가 limit보다 많으면 `next_cursor = 마지막 항목 id`
- 타입 프로필 16종 데이터 완성도도 검증 → **전부 완벽** (누락 필드 없음)

---

## 8. 인프라 품질 수정

### 무엇을 했는가

코드 리뷰에서 발견한 심각도 높은 버그 2건을 수정했다.

### 커밋

- `38955a0` — ResponseInterceptor + Prisma 에러 처리

### 수정 내용

**ResponseInterceptor 이중 래핑 버그 (HIGH)**

문제: 모든 응답을 `{data: ...}`로 래핑하는 인터셉터가 페이지네이션 응답 `{items, meta}`도 `{data: {items, meta}}`로 이중 래핑

수정: `items` 필드가 있으면 래핑 건너뜀

```typescript
// 수정 전
('data' in obj || 'error' in obj)

// 수정 후
('data' in obj || 'error' in obj || 'items' in obj)
```

**Prisma 에러 500 노출 버그 (HIGH)**

문제: unique constraint 위반 등 Prisma 에러가 `HttpException`이 아니라서 500으로 노출, 스택 트레이스 유출 가능

수정: `HttpExceptionFilter`에 Prisma 에러 코드별 매핑 추가

| Prisma 코드 | HTTP 상태 | 의미 |
|------------|----------|------|
| P2002 | 409 Conflict | unique constraint 위반 |
| P2025 | 404 Not Found | 레코드 없음 |
| P2003 | 400 Bad Request | FK 참조 오류 |

### 공부 포인트

- `src/common/filters/http-exception.filter.ts`의 `tryParsePrismaError()` — Prisma 에러 객체에는 `code` 필드가 있다 (`P2002` 등)
- `@Catch()` 데코레이터가 모든 예외를 잡으므로, instanceof 분기로 HttpException과 Prisma 에러를 구분

---

## 최종 상태

### 모듈 구현 현황 (전부 완료)

| 모듈 | 엔드포인트 | 테스트 |
|------|----------|--------|
| Auth/Session | 3 | - |
| App (Bootstrap) | 1 | - |
| MBTI | 7 | - |
| Calendar | 5 + worker | - |
| Home + TodayFocus | 2 | 7건 |
| Tasks | 6 | 9건 |
| Ideas | 5 | 9건 |
| Plan | 4 | - |
| Reflect | 3 | 7건 |
| Capture | 1 | 6건 |
| Me | 2 | - |
| Health | 1 | - |
| **합계** | **42** | **47건** (+ util 9건) |

### 다음 단계

- [ ] Flutter SDK 설치
- [ ] `npm run export:openapi`로 스펙 내보내기 후 Dart API 클라이언트 자동 생성
- [ ] Flutter 프로젝트 시작 (계획: `docs/flutter-implementation-plan.md`)
- [ ] 소셜 로그인 SDK 키 발급 (Kakao, Google, Apple, Naver)
- [ ] Google Calendar API 실제 연동 (`calendar-sync.worker.ts`의 stub adapter 교체)
