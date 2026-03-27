# 작업 인수인계

## 프로젝트 요약

- 프로젝트 주제: MBTI/인지기능 기반의 자기관리 및 시간관리 모바일 앱.
- 핵심 약속: 단순히 성격 결과를 보여주는 것이 아니라, 사용자가 자신의 유형에 맞는 방식으로 하루를 운영하도록 돕는다.
- 제품의 중심: 자기관리 + 시간관리.
- Mindfulness는 메인 제품이 아니라 회복 지원 요소로 포함한다.
- 첫 사용자는 창업자지만, 이후 더 넓은 사용자층으로 일반화될 수 있어야 한다.

## 고정된 제품 결정 사항

- 플랫폼: 모바일 우선.
- 인증: Kakao, Google, Apple, Naver 소셜 로그인.
- 세션 모델: 소셜 로그인 -> 백엔드 발급 JWT/refresh token.
- MBTI 진입 플로우:
  - 사용자가 이미 자신의 유형을 알고 있다면 직접 선택을 허용한다.
  - 그렇지 않다면 인앱 type finder를 진행한다.
  - type finder 길이: 24-32문항.
  - 결과 후 best-fit confirmation 단계를 진행한다.
  - 사용자는 이후에도 직접 유형을 변경할 수 있다.
- 공식 MBTI 정책:
  - 인앱 테스트를 공식 MBTI 평가로 포지셔닝하지 않는다.
  - 제품 개인화/type-finder 플로우로 사용한다.
  - 출시 전에는 공식 테스트라는 주장을 피하고 상표/라이선스 이슈를 검토한다.
- MVP 개인화 적용 지점:
  - onboarding/result copy
  - home layout
  - task capture style
  - reminder tone
  - evening reflection questions
  - mindfulness/recovery recommendation
- 유형 전반에서 공통으로 유지할 것:
  - data model
  - auth/session model
  - storage structure
  - calendar sync core
  - base analytics
- 일일 루프:
  - 오늘의 초점 선택
  - 실행
  - 저녁 회고
  - 내일 준비
- 외부 캘린더:
  - MVP에 포함한다
  - 복잡도를 줄이기 위해 기본 범위는 읽기 중심으로 시작한다
- Idea와 Task:
  - 내부 모델은 분리한다
  - capture UX는 최대한 단순하게 유지한다
  - Idea -> Task 전환을 허용한다
- 성공 기준:
  - 사용자가 앱을 매일 연다
  - 사용자가 앱이 자신의 유형에 맞는다고 느낀다
  - 사용자가 생산성/자기관리에 도움이 된다고 느낀다

## 고정된 기술 방향

- 모바일 클라이언트: Flutter.
- 서버 구조: 모바일 앱과 분리된 별도 API 서버.
- 백엔드 런타임/언어: Node.js + TypeScript.
- 백엔드 프레임워크: NestJS + Fastify adapter.
- 영속 DB: PostgreSQL.
- DB 접근 계층: Prisma.
- 비동기 작업 처리: BullMQ.
- 인증/세션:
  - 소셜 로그인 후 백엔드가 JWT/refresh token을 발급한다.
  - JWT/session 상태 관리는 Redis 기반으로 처리한다.
  - refresh token 회전, 세션 조회, 폐기(revocation) 처리는 Redis를 기준으로 설계한다.
- 캘린더 연동:
  - MVP는 읽기 중심(read-focused) 동기화로 시작한다.
  - 모바일 클라이언트가 외부 캘린더 API를 직접 다루지 않고, 백엔드가 연결과 동기화를 소유한다.
  - 외부 이벤트는 내부 `CalendarConnection` / `CalendarEvent` 모델로 정규화해 저장한다.
- 구현 원칙:
  - provider별 차이는 백엔드에서 흡수하고 Flutter 클라이언트는 가능한 한 단순하게 유지한다.
  - 장기 보관이 필요한 provider credential은 Redis가 아니라 안전한 서버 저장소에 보관한다.
  - API 서버는 NestJS 모듈 구조를 기준으로 인증, MBTI, Home, Plan, Reflect, Calendar 도메인을 분리한다.
  - 캘린더 sync, reminder, background processing은 BullMQ worker 기준으로 설계한다.

## 개인화 모델

- 표준 MBTI type-dynamics / cognitive-stack 해석을 사용한다.
- 제품 규칙:
  - dominant function = 기본 Home 플로우와 기본 상호작용 모드
  - auxiliary function = 동기 부여와 Task 선택 지원
  - tertiary function = 안정감/보상/회복 톤
  - inferior function = 과부하 신호와 회복 개입
- 앱은 INFP와 INFJ 같은 비슷해 보이는 유형도 의미 있게 다르게 느껴져야 한다.
- 유형 차이를 단순히 J/P나 피상적인 고정관념으로 축소하지 않는다.
- 행동 데이터는 경험을 미세 조정하는 데만 사용한다:
  - reminder intensity/frequency
  - task granularity suggestions
  - home card ordering
  - reflection tone
- 행동 데이터가 사용자가 선택한 유형을 조용히 덮어써서는 안 된다.

## 핵심 데이터 엔티티

- User
- AuthIdentity
- MBTIProfile
- Task
- Idea
- TodayFocus
- Routine
- CalendarConnection
- CalendarEvent
- MoodEnergyCheck
- Reflection
- MindfulnessPrompt

## MBTI Profile 스키마 방향

각 type profile은 최소한 다음을 정의해야 한다:

- type_code
- cognitive_stack
- home_mode
- task_capture_style
- planning_style
- reminder_tone
- review_prompts
- stress_signals
- recovery_protocol
- forbidden_patterns

## 정보 구조 방향

기본 앱 구조:

- Home
- Plan
- Reflect
- Me
- Global Quick Capture

권장 화면 역할:

- Home: 오늘의 초점, 캘린더 요약, 개인화된 행동 프롬프트, 회복 카드
- Plan: Today / Week / Backlog 뷰
- Reflect: 저녁 회고, mood-energy check, mindfulness 추천
- Me: 유형 프로필, 유형 재설정, 계정, 알림/설정
- Quick Capture: Idea 또는 Task로 내부 라우팅되는 단일 진입점

## 시장/포지셔닝 요약

2026-03-21 기준 빠른 스캔 결론:

- MBTI/content/test/social 앱은 많다.
- 강한 productivity 앱도 많다.
- 하지만 다음 간극을 동시에 채우는 강한 제품은 상대적으로 적다:
  - 깊이 있는 personality/type 기반 경험
  - 실제 task/time/calendar 실행
  - 같은 루프 안의 회복 지원

대략적인 경쟁군:

- 성격 정보/테스트/소셜:
  - Myers-Briggs App
  - Boo
  - PDB
  - 국내 MBTI 테스트/정보/채팅 앱
- 성격 + 셀프케어/습관:
  - Me+
  - Eclo
- 깊은 personality 레이어 없이 실행력이 강한 productivity 앱:
  - Todoist
  - TickTick
  - Sunsama
  - 갓생크루 같은 국내 시간관리 앱

목표 포지션:

- 높은 personality depth
- 높은 execution depth

한 줄 포지셔닝 방향:

- "사용자가 자신의 유형에 맞는 방식으로 하루를 운영하도록 돕는 개인용 운영체제."

## 리스크 / 제약

- 적절한 권리 없이 앱을 공식 MBTI 평가로 마케팅하지 않는다.
- 상표/라이선스 검토 전까지는 이름/마케팅에서 "MBTI" 사용에 주의한다.
- 얕은 "유형 결과 + 일반적인 조언" 수준으로 흘러가지 않도록 한다.
- 해자는 카피라이팅이 아니라 실제 워크플로 차별성에서 나와야 한다.

## 권장 다음 빌드 순서

1. 화면별 제품 명세 작성.
2. database schema와 API surface 정의.
3. type-profile JSON/data structure 정의.
4. 첫 실행 onboarding과 type-finder 플로우 설계.
5. MVP 우선순위에 따라 Home, Quick Capture, Plan, Reflect 구축.
6. 캘린더 연동 추가.
7. 유형별 content pack 추가.

## Prompt 1: 개발 연속 작업

제품/디자인/구현 작업을 이어갈 때는 새 세션에서 아래 프롬프트를 사용한다:

```text
You are continuing work on a mobile-first MBTI/cognitive-function-based self-management and time-management app.

Before doing anything else, read /Users/admin/IdeaProjects/mbti-self-cdm/agent.md and treat it as the source of truth for product direction unless it conflicts with newer user instructions.

Context you must preserve:
- The product is a mobile-first self-management + time-management app.
- Mindfulness is recovery support, not the product center.
- The first user is the founder, but the product should generalize later.
- Authentication is via Kakao, Google, Apple, and Naver social login, with backend-issued JWT/refresh tokens.
- Onboarding flow is:
  - user already knows type -> direct type selection
  - otherwise -> 24-32 question in-app type finder
  - best-fit confirmation
  - type can be manually changed later
- The in-app type finder is not an official MBTI assessment.
- MVP personalization surfaces are:
  - onboarding/result copy
  - home layout
  - task capture style
  - reminder tone
  - evening reflection questions
  - mindfulness/recovery recommendation
- External calendar is included in MVP with a read-focused first approach.
- Idea and Task are separate internal models, but capture UX should stay simple.
- The product must feel meaningfully different across 16 types, especially close-looking types like INFP vs INFJ.
- Behavior data can micro-adjust the experience but must not silently change the user’s type.

Current priorities:
1. Continue from the existing product direction without reopening settled decisions unless absolutely necessary.
2. Prefer concrete artifacts over vague brainstorming.
3. If specs are missing, create them in a build-ready form.

Your task for this session:
- First summarize the current locked decisions from agent.md.
- Then propose the next highest-value artifact on the critical path.
- Unless the user redirects, continue by producing one of:
  - a screen-by-screen MVP spec
  - DB schema / entity relationships
  - API contract draft
  - type-profile JSON/data model
  - implementation plan for the current repo

When making recommendations, optimize for:
- strong type differentiation in UX
- practical implementation scope
- founder-first usefulness
- future launch potential

Do not treat this as a generic MBTI content app. Treat it as a personalized operating system for daily execution and recovery.
```

## Prompt 2: 비즈니스 연속 작업

전략/포지셔닝/출시 작업을 이어갈 때는 새 세션에서 아래 프롬프트를 사용한다:

```text
You are continuing business and product strategy work for a mobile-first MBTI/cognitive-function-based self-management and time-management app.

Before doing anything else, read /Users/admin/IdeaProjects/mbti-self-cdm/agent.md and use it as the base context unless newer user instructions override it.

Context you must preserve:
- The app’s center is self-management + time management.
- Mindfulness exists as recovery support.
- The product is meant to feel genuinely different across 16 types, not like a generic app with MBTI copy pasted on top.
- The in-app type finder is not an official MBTI assessment.
- The likely market gap is the combination of:
  - deep personality-based UX
  - actual task/time/calendar execution
  - recovery support in the same loop
- Existing competitors cluster into:
  - MBTI info/test/social apps
  - personality + self-care/habit apps
  - strong productivity apps without deep personality adaptation

Your job in this session:
- Start by summarizing the product thesis and market position from agent.md.
- Then help with one or more of the following, depending on the user’s ask:
  - target user / ICP definition
  - positioning statement and USP
  - competitor comparison table
  - pricing / monetization ideas
  - launch strategy for Korea first vs global
  - app naming / branding direction
  - messaging for landing page / app store listing
  - validation plan and early user interviews

When advising, keep these constraints in mind:
- Differentiate on actual workflow personalization, not just personality content.
- Avoid claiming official MBTI status unless licensed.
- Favor founder-usable MVP logic over broad but shallow feature sets.
- Preserve the possibility of later launch, not just a personal side project.

If the user does not specify a deliverable, choose the most decision-critical next business artifact and produce it directly.
```
