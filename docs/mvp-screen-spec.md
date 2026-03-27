# MBTI 자기관리 앱 MVP 화면 명세

마지막 업데이트: 2026-03-23

기준 문서: [agent.md](/Users/admin/IdeaProjects/mbti-self-cdm/agent.md)

## 1. 고정된 제품 결정 사항

이 결정들은 `agent.md`에서 가져온 것이며, 사용자가 명시적으로 바꾸지 않는 한 고정으로 취급한다.

- 제품: MBTI/cognitive function dynamics에 따라 개인화되는 모바일 우선 자기관리 및 시간관리 앱
- 핵심 약속: 사용자가 자신의 유형에 맞는 방식으로 하루를 운영하도록 돕는다
- Mindfulness: 주된 제품 기능이 아니라 회복 지원 요소로 포함한다
- Auth: Kakao, Google, Apple, Naver 소셜 로그인과 백엔드 발급 JWT/refresh token
- MBTI onboarding:
  - 사용자가 이미 자신의 유형을 안다면 직접 선택한다
  - 그렇지 않다면 24-32문항의 인앱 type finder를 진행한다
  - 결과 후 best-fit confirmation을 보여준다
  - 이후 수동으로 유형을 변경할 수 있게 한다
- 공식 테스트 정책: type finder를 공식 MBTI 평가로 제시하지 않는다
- MVP 개인화 적용 지점:
  - onboarding/result copy
  - home layout
  - task capture style
  - reminder tone
  - evening reflection questions
  - mindfulness/recovery recommendation
- 외부 캘린더: MVP에 포함하며 초기 범위는 읽기 중심으로 둔다
- Idea와 Task: 내부 모델은 분리하되 capture UX는 단순하게 유지한다
- 일일 루프:
  - 오늘의 초점 선택
  - 실행
  - 저녁 회고
  - 내일 준비
- 행동 데이터는 경험을 미세 조정할 수 있지만, 사용자가 선택한 유형을 조용히 덮어써서는 안 된다

## 2. MVP 목표

- 사용자가 설치 후 한 세션 안에 유형 기반 일일 워크플로에 진입하게 한다
- 특히 비슷해 보이는 유형끼리도 앱 경험이 의미 있게 다르게 느껴지게 한다
- 과도한 초기 설정 없이 일일 루프 전체를 지원한다
- Home 가이드, 계획, 회고, 회복 지원을 통해 매일 다시 열 이유를 만든다

## 3. 주요 내비게이션

하단 내비게이션:

- Home
- Plan
- Reflect
- Me

전역 액션:

- 인증 이후의 모든 메인 화면에서 Quick Capture 버튼을 사용할 수 있다

상위 플로우:

1. 앱 실행 / 세션 부트스트랩
2. 소셜 로그인
3. MBTI 진입 플로우
4. 선택형 캘린더 연결
5. 메인 앱 루프

## 4. 개인화 규칙

UI는 유형별로 달라질 수 있지만, 기본 엔티티 구조는 공통으로 유지한다.

- Dominant function:
  - 기본 Home 강조점과 기본 상호작용 모드를 결정한다
- Auxiliary function:
  - 동기 부여와 Task 선택 지원 방식을 결정한다
- Tertiary function:
  - 보상 톤, 안정감, 회복 프레이밍에 영향을 준다
- Inferior function:
  - 과부하 경고와 회복 개입을 유도한다

MVP에서 허용되는 행동 기반 조정:

- reminder intensity/frequency
- suggested task granularity
- home card order
- reflection tone

MVP에서 허용되지 않는 행동 기반 조정:

- 사용자의 유형을 조용히 재할당하는 것
- 선택된 type profile을 다른 것으로 대체하는 것

## 5. 전역 UX 규칙

- 모바일 우선, 한 손 사용에 맞춰 설계한다
- 깊은 설정 진입보다 빠른 capture를 우선한다
- 유형별 카피는 실용적으로 들려야 하며, 신비주의적으로 보이면 안 된다
- 사용자 데이터가 없을 때는 빈 상태가 다음 의미 있는 행동을 안내해야 한다
- 캘린더는 읽기 중심으로 먼저 시작하며, MVP에서는 복잡한 외부 편집을 지원하지 않는다

## 6. 화면별 명세

### 6.1 앱 실행 / 세션 부트스트랩

목적:

- 사용자에게 유효한 세션, onboarding 완료 상태, MBTI profile이 있는지 판단한다

진입 조건:

- 앱 콜드 스타트
- token 만료 후 앱 재진입

주요 로직:

- 저장된 refresh token을 확인한다
- 필요하면 백엔드 세션을 갱신한다
- 현재 사용자 요약 정보를 가져온다
- 다음에 필요한 화면으로 라우팅한다

라우팅:

- 세션 없음 -> Social Login
- 세션은 있으나 MBTI profile 없음 -> MBTI Entry Choice
- 세션과 MBTI profile 모두 있음 -> Home

상태:

- 로딩 스플래시
- token refresh 실패
- 강제 로그아웃

필수 데이터:

- stored auth tokens
- user onboarding status
- MBTI profile presence

Analytics:

- app_opened
- session_refresh_succeeded
- session_refresh_failed

### 6.2 소셜 로그인

목적:

- 지원하는 소셜 provider로 사용자를 인증하고 앱 token을 획득한다

주요 액션:

- Kakao로 계속하기
- Google로 계속하기
- Apple로 계속하기
- Naver로 계속하기

규칙:

- provider 인증 결과는 백엔드로 돌아와야 한다
- 백엔드는 provider identity를 JWT/refresh token으로 교환한다
- 첫 사용자라면 MBTI onboarding으로 이어진다

콘텐츠 요구사항:

- 로그인하면 개인화된 계획 경험이 열리는지 간단히 설명한다
- privacy link와 terms link를 제공한다

상태:

- provider 선택
- provider webview/native auth 로딩
- 로그인 실패
- 로그인 취소

필수 데이터:

- provider type
- backend token response
- user profile stub

Analytics:

- login_provider_selected
- login_succeeded
- login_failed

### 6.3 MBTI 진입 선택

목적:

- 직접 유형 선택과 인앱 type finder 중 하나를 사용자가 고르게 한다

주요 액션:

- "내 유형을 이미 알고 있어요"
- "유형 찾기를 도와주세요"

카피 규칙:

- finder는 공식 MBTI 평가가 아니라 개인화용이라는 점을 분명히 한다
- 이후 settings에서 유형을 바꿀 수 있음을 강조한다

상태:

- 첫 진입 기본 화면
- 부분 완료된 finder에서 복귀한 상태

Analytics:

- mbti_entry_known_type_selected
- mbti_entry_finder_selected

### 6.4 직접 유형 선택

목적:

- 사용자가 스스로 인지한 유형을 빠르게 입력하도록 한다

주요 액션:

- 16개 유형 중 하나 선택
- 짧은 유형 요약 확인
- 선택 확정

UI 요구사항:

- 16개 유형을 빠르게 훑을 수 있는 grid로 보여준다
- 유형을 탭하면 짧은 요약을 노출한다
- 설명은 중립적이고 비판단적으로 유지한다

검증:

- 계속 진행하기 전 선택이 필요하다

출력:

- source가 `self_selected`인 MBTI profile 생성
- Best-Fit Confirmation으로 이동

Analytics:

- mbti_type_selected
- mbti_type_selection_confirmed

### 6.5 유형 찾기 소개

목적:

- 인앱 type finder 시작 전에 기대치를 맞춘다

주요 액션:

- finder 시작
- MBTI Entry Choice로 돌아가기

콘텐츠 요구사항:

- 예상 문항 수: 24-32
- 예상 소요 시간: 약 3-5분
- 결과는 제품 개인화에 사용된다는 점을 안내한다

Analytics:

- finder_started
- finder_exited_before_start

### 6.6 유형 찾기 질문 흐름

목적:

- 가장 적합한 유형을 추정하는 데 필요한 답변을 수집한다

형식:

- 화면당 질문 하나
- 진행률 표시
- 5점 동의/선호 척도

질문 설계 제약:

- 질문은 과장된 stereotype이 아니라 type dynamics에 매핑되어야 한다
- 관련 차원을 고르게 분배해야 한다
- 문구에서 드러나는 desirability bias를 피해야 한다

주요 액션:

- 답변 선택
- 다음
- 이전
- 저장 후 종료

상태:

- 진행 중
- 세션 재개
- 완료

필수 데이터:

- question id
- answer value
- progress position

Analytics:

- finder_question_answered
- finder_resumed
- finder_completed

### 6.7 유형 찾기 결과

목적:

- 예측된 best-fit type을 보여주고, 그 결과를 제품 맥락에서 설명한다

주요 액션:

- 이 유형으로 계속하기
- 인접한 대안 유형과 비교하기
- 나중에 다시 하기

콘텐츠 요구사항:

- 예측된 type code
- 짧은 cognitive-stack 설명
- 이 결과가 계획, capture, reminder, reflection에 어떤 의미인지 설명

규칙:

- 결과 프레이밍은 실용적으로 유지해야 한다
- "공식 결과"처럼 보이는 표현은 피한다

출력:

- source가 `finder_result`인 임시 MBTI profile 생성
- Best-Fit Confirmation으로 이동

Analytics:

- finder_result_viewed
- finder_result_accepted
- finder_result_compared

### 6.8 Best-Fit Confirmation

목적:

- 제안되거나 선택된 유형이 실제로 맞는지 확인해 낮은 신뢰도의 mismatch를 줄인다

주요 액션:

- "네, 잘 맞아요"
- "비슷한 다른 유형 보기"
- "처음부터 다시"

UX 요구사항:

- 확신이 낮을 때는 인접한 2-3개 유형을 보여준다
- 가까운 유형들 사이의 실질적인 차이를 설명한다
- 나중에 유형을 바꿀 수 있다는 점을 강조한다

출력:

- MBTI profile 최종 확정
- onboarding의 MBTI 단계를 완료 처리
- Calendar Connection Prompt로 이동

Analytics:

- mbti_confirmation_accepted
- mbti_confirmation_changed_type
- mbti_confirmation_restarted

### 6.9 캘린더 연결 안내

목적:

- onboarding 중 선택적으로 읽기 중심 캘린더 동기화를 제안한다

주요 액션:

- 캘린더 연결
- 지금은 건너뛰기

규칙:

- 선택 사항으로 유지하고, 진행을 막지 않는다
- 읽기 중심 초기 범위를 설명한다
- 연결되면 Home과 Plan용 다가오는 이벤트 요약을 가져온다

MVP provider 요구사항:

- 설계는 이후 최소 Google과 Apple calendar 경로를 지원할 수 있어야 한다
- backend model은 `CalendarConnection`을 통해 범용성을 유지해야 한다

출력:

- 연결 시 calendar connection을 만들고 초기 이벤트를 가져온다
- Home으로 이동

Analytics:

- calendar_prompt_connect_selected
- calendar_prompt_skipped
- calendar_connection_succeeded
- calendar_connection_failed

### 6.10 Home

목적:

- 유형별 가이드를 담은 일일 command center 역할을 한다

주요 섹션:

- Today Focus 카드
- 다가오는 캘린더 요약
- 우선순위 Task 목록
- 개인화된 행동 프롬프트
- 현재 궤적 vs 회복 궤적 비교 카드
- 회복 카드

개인화 요구사항:

- dominant function에 따라 상단 카드의 순서와 프레이밍이 달라진다
- reminder/action tone은 유형별로 달라진다
- 현재 궤적 비교 카드는 행동 데이터로 계산하되, 표현 톤과 압박 강도는 유형별 `forbidden_patterns`를 넘지 않아야 한다
- 회복 카드는 stress/recovery profile을 반영한다

주요 액션:

- Today Focus 설정 또는 수정
- Task 열기
- 캘린더 이벤트 맥락 열기
- Quick Capture 실행
- Plan 또는 Reflect로 이동

기본 콘텐츠 규칙:

- `Today Focus`가 없으면 사용자가 하나를 고르도록 Home에서 유도한다
- Task가 비어 있으면 capture 또는 Plan으로 보내야 한다
- 현재 궤적 비교 카드는 사용자를 모욕하거나 죄책감으로 밀어붙이는 용도가 아니라, 현재 패턴의 현실적 비용과 회복 가능성을 동시에 보여주는 용도여야 한다
- 현재 궤적 비교 카드는 최근 행동 데이터가 충분할 때만 노출한다
- 현재 궤적 비교 카드는 반드시 `오늘 바꿀 행동 1개` 수준의 즉시 실행 액션과 함께 노출한다
- ETA/생산성 비교의 기준은 추상적 완벽주의가 아니라 `해당 유형에 맞는 지속 가능한 권장 패턴`이어야 한다
- 과부하 신호가 보이면 회복 카드의 우선순위를 높인다

현재 궤적 비교 카드:

- 목적:
  - 사용자가 지금 패턴을 유지할 때의 현실적 도착 시점과, 회복된 패턴으로 돌아왔을 때의 차이를 직관적으로 보게 한다
- 노출 조건:
  - 활성 목표 또는 대표 outcome이 있다
  - 최근 7-14일 행동 데이터가 최소 기준 이상 쌓였다
  - 추정 신뢰도가 너무 낮지 않다
- 기본 표시 요소:
  - 현재 패턴 유지 시 예상 달성 시점
  - 회복된 패턴 적용 시 예상 달성 시점
  - 현재가 잠재 실행력 대비 어느 정도 수준인지 보여주는 갭 표현
  - 오늘 바꿀 한 가지 행동
- 카피 규칙:
  - `INTJ`, `ESTJ`, `ENTJ` 계열은 더 직접적이고 수치 중심인 표현을 허용할 수 있다
  - `INFP`, `ISFP`, `ENFP`, `ENFJ` 계열은 숫자를 보여주더라도 죄책감 유도 대신 회복 가능한 차이로 프레이밍해야 한다
  - 어떤 유형에서도 비난, 조롱, 인격 평가처럼 읽히는 문구는 금지한다
- 계산 원칙:
  - 최근 완료율, focus 유지율, 일정 대비 실제 실행량, 열린 루프 수 같은 실제 행동 데이터를 사용한다
  - MBTI는 계산식의 근거가 아니라, 권장 회복 패턴과 표현 방식을 정하는 보조 변수로만 사용한다
  - 사용자에게는 추정치임을 분명히 드러내고, 필요하면 신뢰도 레이블을 함께 제공한다

상태:

- 첫날 빈 상태
- Task와 이벤트가 있는 활성 일자
- 캘린더 미연결
- 현재 궤적 비교 카드 노출 상태
- 현재 궤적 비교 카드 비노출 상태
- 과부하/회복 강조 상태

필수 데이터:

- TodayFocus
- top tasks
- upcoming CalendarEvents
- MBTI profile fields for home mode and reminder tone
- recent task execution summary
- recent focus adherence summary
- active goal or representative outcome summary
- recent MoodEnergyCheck if available

Analytics:

- home_viewed
- today_focus_set
- home_task_opened
- home_trajectory_gap_card_viewed
- home_trajectory_gap_action_selected
- home_recovery_card_opened

### 6.11 Quick Capture

목적:

- 사용자가 몇 초 안에 항목을 캡처하고 내부적으로 Idea 또는 Task로 보낼 수 있게 한다

진입 조건:

- 인증된 화면에서의 floating/global capture action

주요 액션:

- 자유 형식 텍스트 입력
- 추후 원탭 음성 입력 지원 가능
- 대상 선택 또는 확인: Task 또는 Idea
- 저장

라우팅 규칙:

- 입력이 실행 행동 + 시간 압박을 드러내면 기본 제안은 Task다
- 입력이 탐색적 성격이면 기본 제안은 Idea다
- 저장 전에는 사용자가 제안을 덮어쓸 수 있다

개인화 요구사항:

- capture prompt 문구는 task capture style에 따라 달라진다
- 어떤 유형은 더 구조화된 템플릿을, 어떤 유형은 빈 입력창을 먼저 볼 수 있다

출력:

- Task 또는 Idea 생성
- Idea로 저장할 때 선택적으로 "convert to task" 제안

상태:

- 빈 상태
- 입력 중
- 저장 성공
- validation failure

Analytics:

- quick_capture_opened
- quick_capture_saved_task
- quick_capture_saved_idea
- quick_capture_route_changed

### 6.12 Task 상세 / 편집

목적:

- 앱이 무거운 프로젝트 관리 도구가 되지 않으면서도 가벼운 수준의 Task 정제를 지원한다

편집 가능 필드:

- title
- note
- status
- due date/time
- linked Today Focus
- energy estimate
- reminder preference

선택적 MVP 필드:

- linked calendar event reference
- source conversion from Idea

주요 액션:

- 완료 처리
- 일정 다시 잡기
- reminder 추가
- Today Focus에 연결

규칙:

- 폼은 간결하게 유지해야 한다
- Task 세분화 제안은 유형/행동에 따라 달라질 수 있다

Analytics:

- task_viewed
- task_completed
- task_rescheduled
- task_linked_to_focus

### 6.13 Idea 상세 / 편집

목적:

- 즉시 실행을 강요하지 않으면서 생각과 가능성을 보존한다

편집 가능 필드:

- title
- note
- tags
- status

주요 액션:

- note 수정
- 보관
- Task로 전환

규칙:

- Idea는 기본적으로 날짜나 일정 필드를 요구하지 않는다
- Task로 전환할 때는 title과 note를 미리 채운다

Analytics:

- idea_viewed
- idea_converted_to_task
- idea_archived

### 6.14 Plan

목적:

- 유형 적합 가이드를 잃지 않으면서 Today, Week, Backlog를 사용자가 통제할 수 있게 한다

하위 뷰:

- Today
- Week
- Backlog

Today 뷰:

- 우선순위 Task 목록
- Today Focus 배치
- 간단한 일정 재조정 및 완료 액션

Week 뷰:

- 사용자 Task와 가져온 캘린더 이벤트를 합쳐 보여주는 뷰
- 읽기 중심 외부 이벤트
- 과부하 또는 계획 부족 구간 노출

Backlog 뷰:

- 미배정 Task
- 필요 시 전환 대기 중인 Idea 노출

개인화 요구사항:

- planning style은 기본 정렬, 프롬프트, 다음 추천 액션에 영향을 준다
- 예를 들어 어떤 유형은 focus-first 프롬프트를, 다른 유형은 sequence-first 프롬프트를 볼 수 있다

주요 액션:

- Task 순서 재정렬
- 오늘로 배정
- 일정 다시 잡기
- backlog 검토
- Task 또는 이벤트 열기

상태:

- Task 없음
- 캘린더 미연결
- 충돌이 많은 주간

필수 데이터:

- Task list by status/date
- TodayFocus
- CalendarEvents
- planning_style from MBTI profile

Analytics:

- plan_viewed
- plan_task_reordered
- plan_task_scheduled
- week_conflict_surface_viewed

### 6.15 Reflect

목적:

- reflection, mood/energy check, recovery support를 통해 일일 루프를 닫는다

주요 섹션:

- mood 및 energy 체크
- 완료된 Task 요약
- 놓친 일/이월 검토
- 유형별 reflection prompts
- mindfulness/recovery recommendation

개인화 요구사항:

- reflection questions는 유형에 따라 달라진다
- recovery recommendation은 stress signals와 recovery protocol에 매핑된다
- 톤은 조정하되 치료적 jargon처럼 느껴지면 안 된다

주요 액션:

- mood/energy 기록
- reflection prompt 응답
- 미완료 Task 이월
- mindfulness/recovery prompt 수락

상태:

- 완료된 Task 없음
- reflection 이력 건너뜀
- 높은 stress signal

필수 데이터:

- completed and incomplete tasks
- TodayFocus
- MBTI review prompts
- stress signals and recovery protocol

Analytics:

- reflect_viewed
- mood_energy_logged
- reflection_submitted
- recovery_prompt_opened

### 6.16 Me

목적:

- profile, 유형 설정, 계정, 연동, 알림 선호를 관리한다

주요 섹션:

- 현재 유형 profile
- 유형 설명 요약
- 유형 변경
- 연결된 계정
- calendar connections
- notifications
- 법적/계정 액션

주요 액션:

- 현재 유형 검토
- 유형 재설정 또는 변경
- 캘린더 재연결
- 알림 스타일 관리
- 로그아웃

규칙:

- 유형 변경은 명시적이고 되돌릴 수 있어야 한다
- 행동 데이터가 유형을 조용히 바꾸게 두면 안 된다

Analytics:

- me_viewed
- type_change_started
- type_changed
- notification_preferences_updated

## 7. 화면 간 플로우

### 7.1 첫 실행 플로우

1. 앱 실행
2. Social Login
3. MBTI Entry Choice
4. 직접 유형 선택 또는 Type Finder
5. Best-Fit Confirmation
6. Calendar Connection Prompt
7. Home

### 7.2 일일 사용 플로우

1. Home 열기
2. Today Focus 확인 또는 설정
3. Home 또는 Plan에서 실행
4. Quick Capture로 새 Task/Idea 캡처
5. Reflect에서 하루 검토
6. 이월 및 계획 액션으로 내일 준비

### 7.3 Idea -> Task 변환

1. Quick Capture 또는 Idea Detail에서 Idea 생성
2. 사용자가 나중에 검토
3. Task로 전환
4. 필요 시 Today Focus에 배정하거나 Plan에서 일정 지정

## 8. MVP 빈 상태

- 유형 profile 없음: 즉시 MBTI 플로우로 보낸다
- Task 없음: Quick Capture를 유도하거나 Plan에서 첫 Task를 추가하게 한다
- Today Focus 없음: Home이 하나를 고르도록 요청한다
- 캘린더 없음: 연결 CTA를 보여주되 앱 사용은 가능해야 한다
- reflection 이력 없음: Reflect가 왜 저녁 체크인이 중요한지 설명한다

## 9. MVP 비목표

- 공식 MBTI 인증 또는 채점 언어
- 복잡한 프로젝트 관리
- 깊은 수준의 외부 캘린더 편집
- 소셜/커뮤니티 기능
- 메인 경험이 되는 무거운 journaling

## 10. 다음 아티팩트를 위한 구현 시사점

이 화면 명세는 다음 기술 아티팩트를 이 순서로 만들 것을 시사한다:

1. database schema / entity relationships
2. API contract draft
3. type-profile JSON/data model

화면만으로도 이미 필요한 최소 엔티티:

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

## 11. 열린 구현 메모

- type finder scoring model은 아직 정해지지 않았으므로 구현 전에 정의해야 한다
- notification logic은 구체적인 reminder model이 필요하지만 `reminder_tone`과는 호환되어야 한다
- calendar provider 세부 사항은 나중으로 미룰 수 있지만, connection model은 처음부터 여러 provider를 지원해야 한다
- 유형별 copy pack은 view logic에 하드코딩하지 말고 데이터로 저장해야 한다
