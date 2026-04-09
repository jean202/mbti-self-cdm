# Flutter 클라이언트 구현 계획

마지막 업데이트: 2026-04-09

기준 문서:

- [mvp-screen-spec.md](mvp-screen-spec.md)
- [api-contract.md](api-contract.md)
- [openapi.json](openapi.json)

## 1. 목표

- OpenAPI 스펙 기반 타입 세이프 API 클라이언트를 자동 생성한다
- mvp-screen-spec.md에 정의된 화면을 구현한다
- 유형별 개인화가 UI에 실제 반영되는 것을 검증한다

## 2. 기술 스택

- Flutter 3.x (최신 stable)
- Dart 3.x
- 상태관리: Riverpod 2
- 라우팅: go_router
- HTTP 클라이언트: dio
- 로컬 저장소: flutter_secure_storage (토큰), shared_preferences (설정)
- API 클라이언트: openapi-generator (dart-dio)

## 3. 프로젝트 구조

```
client/
├── lib/
│   ├── main.dart
│   ├── app.dart                    # MaterialApp + GoRouter 설정
│   ├── api/                        # 자동 생성된 API 클라이언트
│   │   └── (openapi-generator 출력)
│   ├── core/
│   │   ├── auth/                   # 토큰 저장/갱신, AuthNotifier
│   │   ├── config/                 # 환경 설정 (baseUrl 등)
│   │   ├── router/                 # GoRouter 설정, 가드
│   │   └── theme/                  # 테마, 유형별 색상/스타일
│   ├── features/
│   │   ├── onboarding/
│   │   │   ├── login/              # 소셜 로그인
│   │   │   ├── mbti_entry/         # 유형 선택 / Finder
│   │   │   └── calendar_connect/   # 캘린더 연결
│   │   ├── home/
│   │   │   ├── home_screen.dart
│   │   │   ├── widgets/            # TodayFocusCard, TaskCard 등
│   │   │   └── home_provider.dart
│   │   ├── plan/
│   │   │   ├── today/
│   │   │   ├── week/
│   │   │   └── backlog/
│   │   ├── reflect/
│   │   │   ├── daily_reflect_screen.dart
│   │   │   └── mood_energy_check/
│   │   ├── capture/                # Quick Capture 바텀시트
│   │   └── me/                     # 프로필, 설정, 유형 변경
│   └── shared/
│       ├── widgets/                # 공용 위젯
│       └── models/                 # 공용 모델 (필요 시)
├── test/
├── pubspec.yaml
└── analysis_options.yaml
```

## 4. 구현 우선순위

### Phase 1. 프로젝트 초기화

- Flutter 프로젝트 생성
- OpenAPI로 API 클라이언트 자동 생성
- dio + 토큰 인터셉터 설정
- go_router + 인증 가드 설정

### Phase 2. 온보딩 플로우

- 소셜 로그인 (Kakao, Google, Apple, Naver)
- MBTI 진입 선택 → 직접 선택 / Finder
- Finder 질문 UI (28문항, 진행률 표시)
- 결과 확인 + 확정
- 캘린더 연결 (선택)

### Phase 3. First Vertical Slice

- Home 화면 (개인화 프롬프트, TodayFocus, TopTasks, CalendarSummary)
- Today Focus 생성/수정
- Quick Capture → Task/Idea 분류
- 하단 네비게이션 (Home, Plan, Reflect, Me)

### Phase 4. 일일 루프

- Plan 화면 (오늘/주간/백로그)
- Task CRUD + complete/reschedule
- Idea 목록 + 태스크 변환
- Reflect 화면 (무드/에너지, 일일 회고)

### Phase 5. 마무리

- Me 화면 (프로필, 설정, 유형 변경)
- 유형별 테마/카피 적용 검증
- 에러 처리, 빈 상태, 로딩 상태
- 성능 최적화

## 5. API 클라이언트 생성 방법

```bash
# 1. OpenAPI 스펙 최신화
npm run export:openapi

# 2. API 클라이언트 생성 (Flutter 프로젝트 안에서)
npx @openapitools/openapi-generator-cli generate \
  -i ../docs/openapi.json \
  -g dart-dio \
  -o lib/api \
  --additional-properties=pubName=mbti_api

# 3. 의존성 설치
dart pub get
```

## 6. 인증 흐름 (클라이언트)

```
앱 시작
  → flutter_secure_storage에서 refresh_token 확인
  → 있으면 POST /v1/auth/refresh → 새 access_token 획득
  → 없으면 소셜 로그인 화면으로
  → GET /v1/app/bootstrap → onboarding_status 확인
  → COMPLETED → Home
  → MBTI_PENDING → MBTI 진입
  → CALENDAR_PENDING → 캘린더 연결
```

## 7. 개인화 적용 포인트

Home 화면에서 백엔드가 내려주는 개인화 데이터:

- `personalized_prompt` → 상단 인사 카드
- `home_mode.card_priority` → 카드 순서 결정
- `recovery_card` → 스트레스 회복 카드
- `home_mode.default_interaction` → 인터랙션 스타일

## 8. 선행 작업

Flutter 프로젝트 시작 전 필요한 것:

- [x] 백엔드 API 완성
- [x] OpenAPI 스펙 내보내기 (`npm run export:openapi`)
- [x] Swagger UI 동작 확인
- [ ] Flutter SDK 설치
- [ ] 소셜 로그인 SDK 키 발급 (Kakao, Google, Apple, Naver)
