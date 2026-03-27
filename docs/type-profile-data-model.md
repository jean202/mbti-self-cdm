# type-profile JSON / 데이터 모델

마지막 업데이트: 2026-03-26

기준 문서:

- [agent.md](/Users/admin/IdeaProjects/mbti-self-cdm/agent.md)
- [mvp-screen-spec.md](/Users/admin/IdeaProjects/mbti-self-cdm/docs/mvp-screen-spec.md)
- [db-schema.md](/Users/admin/IdeaProjects/mbti-self-cdm/docs/db-schema.md)
- [api-contract.md](/Users/admin/IdeaProjects/mbti-self-cdm/docs/api-contract.md)

## 1. 목적

- 유형별 UX 차이를 코드에 하드코딩하지 않고 데이터로 관리한다
- `Home`, `Plan`, `Reflect`, `Quick Capture`, onboarding 결과 카피를 같은 source에서 읽게 한다
- `INFP`와 `INFJ`처럼 가까운 유형도 실제 동작과 문구 차이가 나도록 만든다
- 행동 데이터는 type profile을 덮어쓰지 않고, profile이 허용한 범위 안에서만 미세 조정한다

## 2. 저장 전략

MVP에서는 type profile을 API 서버가 소유하는 정적 master data pack으로 관리한다.

- 저장 위치: `data/type-profiles/<profile_version>/`
- 사용자별 DB에는 `type_code`, `profile_version`만 저장한다
- 서버는 요청 시 `MBTIProfile.type_code` + `profile_version`으로 type profile JSON을 로드한다
- 서버는 이 profile과 사용자 행동 데이터, 도메인 데이터를 조합해서 `Home`, `Plan`, `Reflect` 응답을 구성한다

이 구조를 쓰는 이유:

- 유형별 로직을 view 코드에서 분리할 수 있다
- copy 수정과 UX 미세 조정을 배포 단위로 관리할 수 있다
- 향후 16개 유형 전체를 확장해도 스키마가 흔들리지 않는다

## 3. 파일 구조

권장 구조:

```text
data/type-profiles/
  2026-03-v1/
    manifest.json
    ISTJ.json
    ...
    ENTJ.json
```

현재 `2026-03-v1` pack에는 16개 유형 JSON을 모두 포함한다.

- 각 파일은 같은 shape를 유지한다
- 가까운 유형 차이는 값 차이로 표현하고, 스키마 차이로 처리하지 않는다

## 4. 루트 스키마

각 type profile JSON은 아래 루트 필드를 가진다.

| 필드 | 타입 | 필수 | 역할 | 주요 소비 지점 |
| --- | --- | --- | --- | --- |
| `schema_version` | `string` | Y | JSON 구조 버전 | 서버 loader |
| `profile_version` | `string` | Y | profile pack 버전 | `MBTIProfile.profile_version` 매칭 |
| `type_code` | `string` | Y | 4글자 유형 코드 | 전역 |
| `cognitive_stack` | `object` | Y | dominant/auxiliary/tertiary/inferior 정의 | 결과 화면, 설명 카드 |
| `differentiation` | `object` | Y | 핵심 동기와 유사 유형 대비 차이 | onboarding 결과, QA 기준 |
| `home_mode` | `object` | Y | Home의 기본 카드 순서와 인터랙션 | `GET /v1/home` |
| `task_capture_style` | `object` | Y | Quick Capture의 기본 구조와 라우팅 편향 | capture UI, route suggestion |
| `planning_style` | `object` | Y | Today/Week/Backlog의 기본 정렬과 계획 방식 | `GET /v1/plan/*` |
| `reminder_tone` | `object` | Y | reminder tone과 intensity 경계 | notification payload |
| `review_prompts` | `array` | Y | Reflect 질문 key와 의도 | `GET /v1/reflect/daily` |
| `stress_signals` | `array` | Y | 과부하 징후와 UI escalation 힌트 | Home recovery card, Reflect |
| `recovery_protocol` | `object` | Y | 회복 절차와 연동 prompt key | recovery card, mindfulness 추천 |
| `forbidden_patterns` | `array` | Y | 해당 유형에서 피해야 할 UX 패턴 | 디자인/QA 기준 |
| `micro_adjustment_bounds` | `object` | Y | 행동 데이터가 움직일 수 있는 범위 | personalization engine |
| `copy` | `object` | Y | locale별 문구 묶음 | onboarding, Home, Plan, Reflect |

## 5. 세부 필드 설계

### 5.1 `cognitive_stack`

예시:

```json
{
  "dominant": "Ni",
  "auxiliary": "Fe",
  "tertiary": "Ti",
  "inferior": "Se"
}
```

규칙:

- 기능 순서는 고정된 의미를 가진다
- 이 필드는 설명용이면서도 `home_mode`, `planning_style`, `recovery_protocol` 설계의 근거가 된다

### 5.2 `differentiation`

역할:

- 유형의 일반 소개가 아니라 제품 맥락에서의 작동 원리를 정의한다
- 특히 가까운 유형과의 차이를 product language로 설명한다

권장 필드:

- `core_driver`
- `decision_support`
- `close_type_contrasts`

### 5.3 `home_mode`

역할:

- Home 화면의 첫 인상과 기본 상호작용 방식을 고정한다

권장 필드:

- `mode_key`
- `default_interaction`
- `card_priority`
- `empty_state_route`
- `overload_card_priority`

`card_priority`에 들어갈 수 있는 기본 card key:

- `today_focus`
- `priority_tasks`
- `calendar_summary`
- `personalized_prompt`
- `recovery_card`

### 5.4 `task_capture_style`

역할:

- Quick Capture가 더 구조화된 입력을 먼저 보여줄지, 빈 입력창을 먼저 보여줄지 결정한다
- Task와 Idea 사이의 기본 편향을 정의한다

권장 필드:

- `style_key`
- `default_target_bias`
- `prompt_mode`
- `suggested_fields`
- `idea_to_task_prompt_style`

허용 `default_target_bias` 초안:

- `TASK`
- `IDEA`
- `NEUTRAL`

### 5.5 `planning_style`

역할:

- Today / Week / Backlog 화면의 기본 정렬과 안내 문구 방향을 정의한다

권장 필드:

- `style_key`
- `today_strategy`
- `week_strategy`
- `backlog_strategy`
- `default_sort`

### 5.6 `reminder_tone`

역할:

- reminder 문구의 톤과 intensity 상한/하한을 정한다

권장 필드:

- `tone_key`
- `intensity_floor`
- `intensity_ceiling`
- `cadence_bias`

중요한 제약:

- 행동 데이터는 이 범위 안에서만 강도를 조정할 수 있다
- 예를 들어 `low ~ medium` profile은 자동으로 `high` cadence로 올라가면 안 된다

### 5.7 `review_prompts`

역할:

- Reflect 화면의 질문 key와 질문 의도를 정의한다

형태:

```json
[
  {
    "key": "alignment_check",
    "surface": "reflect",
    "intent": "오늘 한 일이 내가 중요하게 여긴 방향과 맞았는지 점검"
  }
]
```

노트:

- 실제 사용자 노출 문구는 `copy.<locale>.review_prompt_labels`에서 제공한다

### 5.8 `stress_signals`

역할:

- 과부하 징후를 감지했을 때 어떤 UI escalation을 해야 하는지 힌트를 준다

권장 필드:

- `key`
- `trigger_hint`
- `ui_escalation`

### 5.9 `recovery_protocol`

역할:

- 회복 카드와 mindfulness 추천이 어떤 순서와 길이로 제안될지 정의한다

권장 필드:

- `protocol_key`
- `default_duration_minutes`
- `steps`
- `recommended_prompt_keys`

노트:

- `recommended_prompt_keys`는 `MindfulnessPrompt` master data와 연결되는 key다

### 5.10 `forbidden_patterns`

역할:

- 해당 유형 UX에서 피해야 할 패턴을 명시해 하드코딩 실수를 막는다

예:

- 죄책감 기반 reminder
- 지나치게 바쁜 첫 화면
- 차가운 성과 압박 문구

### 5.11 `micro_adjustment_bounds`

역할:

- 행동 데이터가 건드릴 수 있는 경계를 명시한다

권장 필드:

- `reminder_intensity`
- `task_granularity`
- `home_card_order`
- `reflection_tone`

규칙:

- behavior engine은 반드시 이 필드 안에서만 조정한다
- `type_code` 자체나 `mode_key`를 바꾸면 안 된다
- 행동 데이터 기반 ETA/생산성 비교가 들어가더라도, 유형 profile은 `표현 방식`, `숫자 노출 강도`, `행동 제안 톤`만 제한해야 한다
- ETA 자체는 최근 행동 데이터와 목표 데이터에서 계산하고, 유형만으로 날짜나 생산성 계수를 직접 정하면 안 된다

### 5.12 `copy`

역할:

- locale별 사용자 노출 카피를 묶는다

권장 구조:

```json
{
  "ko-KR": {
    "type_title": "INFJ",
    "type_summary": "짧은 요약",
    "onboarding": {},
    "home": {
      "opening_prompt": "기본 홈 프롬프트",
      "trajectory_gap_title": "현재 궤적 비교 카드 제목",
      "trajectory_gap_current_label": "현재 패턴 유지 시",
      "trajectory_gap_recovered_label": "회복 패턴 적용 시",
      "trajectory_gap_action_label": "오늘 바꿀 한 가지"
    },
    "capture": {},
    "plan": {},
    "reminders": {},
    "review_prompt_labels": {},
    "recovery": {}
  }
}
```

규칙:

- key는 안정적으로 유지하고, 실제 노출 문구는 locale별로 분리한다
- MVP는 `ko-KR`만 있어도 되지만, 구조는 다국어 확장 가능하게 잡는다
- `trajectory_gap_*` 카피는 각 유형의 `forbidden_patterns`와 충돌하지 않아야 한다
- 숫자 노출을 약하게 해야 하는 유형도 있으므로, 같은 계산 결과를 요약 문장 중심으로 표현할 수 있게 설계한다

## 6. 런타임 사용 방식

서버가 profile을 사용하는 기본 흐름:

1. 사용자 `MBTIProfile`에서 `type_code`와 `profile_version`을 읽는다
2. `data/type-profiles/<profile_version>/<type_code>.json`을 로드한다
3. 도메인 데이터와 결합한다
4. 행동 데이터가 있다면 `micro_adjustment_bounds` 안에서만 미세 조정한다
5. 최종 payload를 `Home`, `Plan`, `Reflect`, onboarding 응답으로 반환한다

Home의 현재 궤적 비교 카드 추가 규칙:

- ETA/생산성 비교는 최근 행동 데이터와 현재 목표 데이터를 기반으로 계산한다
- type profile은 카드의 노출 허용 범위, 문구 톤, 수치 강조 강도, CTA 문구를 결정한다
- 특정 유형에서 금지된 패턴이 있다면 숫자보다 서술형 요약을 우선한다

## 7. API 연결 지점

주요 연결 관계:

- `GET /v1/mbti/type-catalog`
  - `copy.<locale>.type_title`
  - `copy.<locale>.type_summary`
- `POST /v1/mbti/finder/attempts/{attempt_id}/complete`
  - `cognitive_stack`
  - `copy.<locale>.onboarding.result_summary`
- `GET /v1/home`
  - `home_mode`
  - `copy.<locale>.home`
  - `recovery_protocol`
  - 행동 데이터 기반 현재 궤적 비교 카드
- `GET /v1/plan/today`, `GET /v1/plan/week`, `GET /v1/plan/backlog`
  - `planning_style`
  - `copy.<locale>.plan`
- `POST /v1/capture/analyze`
  - `task_capture_style`
- notification 생성
  - `reminder_tone`
  - `copy.<locale>.reminders.samples`
- `GET /v1/reflect/daily`
  - `review_prompts`
  - `copy.<locale>.review_prompt_labels`
  - `recovery_protocol`

## 8. 버전 관리 규칙

- `schema_version`: JSON shape가 바뀔 때 올린다
- `profile_version`: 콘텐츠나 UX tuning이 바뀔 때 올린다
- 사용자 `MBTIProfile.profile_version`은 어떤 pack으로 응답을 만들었는지 추적하기 위한 값이다

권장 규칙:

- breaking change: 새 `schema_version`
- non-breaking tuning: 새 `profile_version`

## 9. Full Pack 상태

현재 `2026-03-v1` pack에는 16개 유형 JSON이 모두 포함되어 있다.

- pack manifest: [manifest.json](/Users/admin/IdeaProjects/mbti-self-cdm/data/type-profiles/2026-03-v1/manifest.json)
- example profiles: [INFJ.json](/Users/admin/IdeaProjects/mbti-self-cdm/data/type-profiles/2026-03-v1/INFJ.json), [INFP.json](/Users/admin/IdeaProjects/mbti-self-cdm/data/type-profiles/2026-03-v1/INFP.json)

이 pack은 다음을 검증하기 위한 첫 번째 전체 데이터 셋이다.

- 16개 유형이 모두 같은 shape로 로드되는지
- 가까운 유형이 `card_priority`, `default_target_bias`, `planning_style`, `reminder_tone`, `review_prompts`에서 실제로 다르게 동작하는지
- type-specific copy를 코드가 아니라 JSON에서 읽어도 충분한지

## 10. 다음 단계

이 문서 다음으로 추천하는 작업:

1. `MindfulnessPrompt` master data key와 `recommended_prompt_keys` 연결
2. API 서버 구현 스택 확정 후 type profile loader 작성
3. `GET /v1/home`와 `GET /v1/reflect/daily`의 personalized payload 조합 로직 구현
4. type-profile 기반 reminder copy selection 규칙 확정
