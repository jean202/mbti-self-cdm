# API 계약 초안

마지막 업데이트: 2026-03-26

기준 문서:

- [agent.md](/Users/admin/IdeaProjects/mbti-self-cdm/agent.md)
- [mvp-screen-spec.md](/Users/admin/IdeaProjects/mbti-self-cdm/docs/mvp-screen-spec.md)
- [technical-stack-decision.md](/Users/admin/IdeaProjects/mbti-self-cdm/docs/technical-stack-decision.md)
- [db-schema.md](/Users/admin/IdeaProjects/mbti-self-cdm/docs/db-schema.md)

## 1. 문서 목적

- 이 문서는 Flutter 클라이언트와 별도 API 서버 사이의 `v1` 논리 계약 초안이다
- 특정 서버 프레임워크나 DB 벤더에 종속되지 않는 수준으로 작성한다
- 서버 내부 전용 OAuth callback route는 포함하지 않고, 모바일 클라이언트가 직접 호출하는 API만 다룬다

## 2. 공통 규칙

Base path:

- `/v1`

전송 형식:

- 요청과 응답 본문은 `application/json`
- 성공 응답은 기본적으로 `{ "data": ... }`
- 실패 응답은 기본적으로 `{ "error": { ... } }`

인증:

- 인증이 필요한 API는 `Authorization: Bearer <access_token>` 사용
- refresh는 별도 엔드포인트에서 처리

권장 헤더:

- `Authorization`
- `X-Device-Id`
- `X-App-Version`
- `Idempotency-Key`

시간 규칙:

- `timestamp`는 ISO 8601 UTC 문자열
- `local_date`는 `YYYY-MM-DD`
- `local_date`는 사용자 `timezone` 기준으로 해석

페이징:

- 목록 API는 기본적으로 `cursor` 기반
- 응답 `meta` 예시:

```json
{
  "data": [],
  "meta": {
    "next_cursor": "abc123"
  }
}
```

에러 형식:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "title is required",
    "details": {
      "field": "title"
    }
  }
}
```

대표 에러 코드:

- `UNAUTHORIZED`
- `TOKEN_EXPIRED`
- `FORBIDDEN`
- `NOT_FOUND`
- `VALIDATION_ERROR`
- `CONFLICT`
- `ONBOARDING_INCOMPLETE`
- `PROVIDER_AUTH_FAILED`
- `CALENDAR_SYNC_FAILED`

## 3. 공통 응답 오브젝트

### 3.1 `UserSummary`

```json
{
  "id": "uuid",
  "display_name": "홍길동",
  "primary_email": "user@example.com",
  "locale": "ko-KR",
  "timezone": "Asia/Seoul",
  "onboarding_status": "MBTI_PENDING"
}
```

### 3.2 `OnboardingState`

```json
{
  "status": "MBTI_PENDING",
  "next_step": "MBTI_ENTRY",
  "is_completed": false
}
```

허용 `next_step` 초안:

- `SOCIAL_LOGIN`
- `MBTI_ENTRY`
- `MBTI_CONFIRMATION`
- `CALENDAR_CONNECT`
- `HOME`

### 3.3 `MBTIProfileSummary`

```json
{
  "type_code": "INFJ",
  "source": "FINDER_RESULT",
  "is_user_confirmed": true,
  "confidence_score": 0.82,
  "profile_version": "2026-03-v1"
}
```

### 3.4 `TokenBundle`

```json
{
  "access_token": "jwt",
  "access_token_expires_in": 3600,
  "refresh_token": "opaque-or-jwt",
  "refresh_token_expires_in": 2592000,
  "session_id": "uuid"
}
```

## 4. 인증 / 세션 API

### 4.1 `POST /v1/auth/social/login`

목적:

- 소셜 provider 인증 결과를 앱 세션으로 교환한다

인증:

- 불필요

요청:

```json
{
  "provider": "GOOGLE",
  "provider_payload": {
    "id_token": "id-token",
    "nonce": "optional-nonce"
  },
  "device": {
    "device_id": "device-123",
    "platform": "IOS",
    "app_version": "1.0.0"
  }
}
```

노트:

- `provider_payload`는 provider별로 다를 수 있다
- 현재 운영 기준 입력은 `id_token`이다
- `authorization_code` exchange는 아직 구현하지 않았다
- 개발 환경에서만 `provider_user_id` 또는 `provider_email` 우회 입력을 허용할 수 있다
- Kakao, Google, Apple, Naver SDK가 넘겨주는 결과를 서버가 검증 가능한 형태로 받는다

응답:

```json
{
  "data": {
    "tokens": {
      "access_token": "jwt",
      "access_token_expires_in": 3600,
      "refresh_token": "refresh",
      "refresh_token_expires_in": 2592000,
      "session_id": "uuid"
    },
    "user": {
      "id": "uuid",
      "display_name": "홍길동",
      "primary_email": "user@example.com",
      "locale": "ko-KR",
      "timezone": "Asia/Seoul",
      "onboarding_status": "MBTI_PENDING"
    },
    "onboarding": {
      "status": "MBTI_PENDING",
      "next_step": "MBTI_ENTRY",
      "is_completed": false
    }
  }
}
```

### 4.2 `POST /v1/auth/refresh`

목적:

- refresh token으로 access token과 refresh token을 회전시킨다

인증:

- 불필요

요청:

```json
{
  "refresh_token": "refresh",
  "session_id": "uuid",
  "device_id": "device-123"
}
```

응답:

```json
{
  "data": {
    "tokens": {
      "access_token": "jwt",
      "access_token_expires_in": 3600,
      "refresh_token": "refresh-rotated",
      "refresh_token_expires_in": 2592000,
      "session_id": "uuid"
    }
  }
}
```

### 4.3 `POST /v1/auth/logout`

목적:

- 현재 세션 또는 전체 세션을 폐기한다

인증:

- 필요

요청:

```json
{
  "refresh_token": "refresh",
  "logout_all_devices": false
}
```

응답:

```json
{
  "data": {
    "success": true
  }
}
```

### 4.4 `GET /v1/app/bootstrap`

목적:

- 앱 실행 시 현재 세션과 onboarding 진행 상태를 확인한다

인증:

- 필요

응답:

```json
{
  "data": {
    "user": {
      "id": "uuid",
      "display_name": "홍길동",
      "primary_email": "user@example.com",
      "locale": "ko-KR",
      "timezone": "Asia/Seoul",
      "onboarding_status": "CALENDAR_PENDING"
    },
    "onboarding": {
      "status": "CALENDAR_PENDING",
      "next_step": "CALENDAR_CONNECT",
      "is_completed": false
    },
    "mbti_profile": {
      "type_code": "INFJ",
      "source": "SELF_SELECTED",
      "is_user_confirmed": true,
      "confidence_score": null,
      "profile_version": "2026-03-v1"
    },
    "has_calendar_connection": false
  }
}
```

## 5. MBTI / 온보딩 API

### 5.1 `GET /v1/mbti/type-catalog`

목적:

- 직접 유형 선택 화면에 필요한 16개 유형의 짧은 요약 정보를 제공한다

인증:

- 필요

응답:

```json
{
  "data": [
    {
      "type_code": "INFJ",
      "title": "INFJ",
      "summary": "짧은 설명",
      "cognitive_stack": ["Ni", "Fe", "Ti", "Se"]
    }
  ]
}
```

### 5.2 `POST /v1/mbti/profile/self-selection`

목적:

- 사용자가 직접 선택한 유형으로 임시 profile을 만든다

인증:

- 필요

요청:

```json
{
  "type_code": "INFJ"
}
```

응답:

```json
{
  "data": {
    "mbti_profile": {
      "type_code": "INFJ",
      "source": "SELF_SELECTED",
      "is_user_confirmed": false,
      "confidence_score": null,
      "profile_version": "2026-03-v1"
    },
    "onboarding": {
      "status": "MBTI_PENDING",
      "next_step": "MBTI_CONFIRMATION",
      "is_completed": false
    }
  }
}
```

### 5.3 `POST /v1/mbti/finder/attempts`

목적:

- type finder 세션을 시작하거나 새 시도를 만든다

인증:

- 필요

요청:

```json
{
  "question_set_version": "2026-03-v1"
}
```

응답:

```json
{
  "data": {
    "attempt_id": "uuid",
    "status": "IN_PROGRESS",
    "question_set_version": "2026-03-v1",
    "questions": [
      {
        "question_id": "q1",
        "prompt": "질문 문구",
        "scale": [1, 2, 3, 4, 5],
        "order": 1
      }
    ],
    "progress": {
      "answered_count": 0,
      "total_count": 28
    }
  }
}
```

### 5.4 `GET /v1/mbti/finder/attempts/{attempt_id}`

목적:

- 중단된 type finder 세션을 재개한다

인증:

- 필요

응답:

```json
{
  "data": {
    "attempt_id": "uuid",
    "status": "IN_PROGRESS",
    "question_set_version": "2026-03-v1",
    "answers": [
      {
        "question_id": "q1",
        "answer_value": 4
      }
    ],
    "questions": [
      {
        "question_id": "q1",
        "prompt": "질문 문구",
        "scale": [1, 2, 3, 4, 5],
        "order": 1
      }
    ],
    "progress": {
      "answered_count": 7,
      "total_count": 28
    }
  }
}
```

### 5.5 `POST /v1/mbti/finder/attempts/{attempt_id}/answers`

목적:

- finder 답변을 저장한다

인증:

- 필요

요청:

```json
{
  "answers": [
    {
      "question_id": "q8",
      "answer_value": 5
    }
  ]
}
```

응답:

```json
{
  "data": {
    "attempt_id": "uuid",
    "progress": {
      "answered_count": 8,
      "total_count": 28
    }
  }
}
```

### 5.6 `POST /v1/mbti/finder/attempts/{attempt_id}/complete`

목적:

- 답변 완료 후 예측 결과를 계산한다

인증:

- 필요

응답:

```json
{
  "data": {
    "attempt_id": "uuid",
    "predicted_type_code": "INFJ",
    "confidence_score": 0.82,
    "alternative_types": ["INFP", "INTJ"],
    "result_summary": {
      "cognitive_stack": ["Ni", "Fe", "Ti", "Se"],
      "planning_summary": "계획 설명",
      "capture_summary": "캡처 설명",
      "reflection_summary": "회고 설명"
    },
    "onboarding": {
      "status": "MBTI_PENDING",
      "next_step": "MBTI_CONFIRMATION",
      "is_completed": false
    }
  }
}
```

### 5.7 `POST /v1/mbti/profile/confirm`

목적:

- 직접 선택 또는 finder 결과를 최종 확정한다

인증:

- 필요

요청:

```json
{
  "type_code": "INFJ",
  "source": "FINDER_RESULT"
}
```

응답:

```json
{
  "data": {
    "mbti_profile": {
      "type_code": "INFJ",
      "source": "FINDER_RESULT",
      "is_user_confirmed": true,
      "confidence_score": 0.82,
      "profile_version": "2026-03-v1"
    },
    "onboarding": {
      "status": "CALENDAR_PENDING",
      "next_step": "CALENDAR_CONNECT",
      "is_completed": false
    }
  }
}
```

### 5.8 `PATCH /v1/mbti/profile`

목적:

- 설정 화면에서 사용자가 명시적으로 유형을 변경한다

인증:

- 필요

요청:

```json
{
  "type_code": "INFP",
  "reason": "MANUAL_CHANGE"
}
```

응답:

```json
{
  "data": {
    "mbti_profile": {
      "type_code": "INFP",
      "source": "MANUAL_CHANGE",
      "is_user_confirmed": true,
      "confidence_score": null,
      "profile_version": "2026-03-v1"
    }
  }
}
```

## 6. 캘린더 연결 / 동기화 API

### 6.1 `POST /v1/calendar/connections/oauth/start`

목적:

- 캘린더 provider 연결 플로우를 시작한다

인증:

- 필요

요청:

```json
{
  "provider": "GOOGLE",
  "redirect_uri": "myapp://calendar-connect"
}
```

응답:

```json
{
  "data": {
    "provider": "GOOGLE",
    "flow_id": "uuid",
    "authorize_url": "https://provider.example.com/oauth/authorize"
  }
}
```

노트:

- 실제 provider callback은 서버 내부 route에서 처리한다
- Flutter 앱은 `authorize_url`을 열고, 연결 완료 후 내부 bootstrap 또는 연결 목록 API를 다시 조회한다

### 6.2 `GET /v1/calendar/connections`

목적:

- 사용자의 캘린더 연결 상태를 조회한다

인증:

- 필요

응답:

```json
{
  "data": [
    {
      "id": "uuid",
      "provider": "GOOGLE",
      "account_label": "user@gmail.com",
      "status": "ACTIVE",
      "last_synced_at": "2026-03-26T00:00:00Z"
    }
  ]
}
```

### 6.3 `POST /v1/onboarding/calendar/skip`

목적:

- onboarding 중 캘린더 연결을 건너뛴다

인증:

- 필요

응답:

```json
{
  "data": {
    "onboarding": {
      "status": "COMPLETED",
      "next_step": "HOME",
      "is_completed": true
    }
  }
}
```

### 6.4 `POST /v1/calendar/connections/{connection_id}/sync`

목적:

- 연결된 캘린더를 수동 동기화한다

인증:

- 필요

응답:

```json
{
  "data": {
    "connection_id": "uuid",
    "status": "SYNCING",
    "queued": true
  }
}
```

### 6.5 `POST /v1/calendar/connections/{connection_id}/revoke`

목적:

- 캘린더 연결을 해제한다

인증:

- 필요

응답:

```json
{
  "data": {
    "connection_id": "uuid",
    "status": "REVOKED"
  }
}
```

### 6.6 `GET /v1/calendar/events`

목적:

- 정규화된 캘린더 이벤트를 조회한다

인증:

- 필요

쿼리 파라미터:

- `from`
- `to`
- `connection_id`

응답:

```json
{
  "data": [
    {
      "id": "uuid",
      "connection_id": "uuid",
      "title": "회의",
      "starts_at": "2026-03-26T01:00:00Z",
      "ends_at": "2026-03-26T02:00:00Z",
      "is_all_day": false,
      "event_status": "CONFIRMED",
      "calendar_name": "Personal"
    }
  ]
}
```

## 7. Home / Plan API

### 7.1 `GET /v1/home`

목적:

- Home 화면에 필요한 집계 데이터를 한 번에 제공한다

인증:

- 필요

쿼리 파라미터:

- `local_date`

응답:

```json
{
  "data": {
    "today_focus": {
      "id": "uuid",
      "local_date": "2026-03-26",
      "title": "핵심 한 가지",
      "note": "설명",
      "status": "ACTIVE"
    },
    "top_tasks": [
      {
        "id": "uuid",
        "title": "발표 자료 수정",
        "status": "PLANNED",
        "due_at": "2026-03-26T03:00:00Z"
      }
    ],
    "calendar_summary": {
      "has_connection": true,
      "items": [
        {
          "id": "uuid",
          "title": "회의",
          "starts_at": "2026-03-26T01:00:00Z",
          "ends_at": "2026-03-26T02:00:00Z"
        }
      ]
    },
    "personalized_prompt": {
      "title": "오늘은 한 가지를 먼저 끝내세요",
      "body": "유형별 행동 프롬프트"
    },
    "trajectory_gap_card": {
      "title": "이 패턴이면 목표 도달이 늦어집니다",
      "current_eta_days": 132,
      "improved_eta_days": 74,
      "productivity_ratio": 0.56,
      "confidence": "MEDIUM",
      "current_summary": "최근 14일 패턴을 유지하면 이 목표는 약 132일 뒤에 닿습니다.",
      "improved_summary": "권장 패턴으로 회복하면 약 74일 수준까지 줄일 수 있습니다.",
      "primary_action": {
        "label": "오늘 바꿀 한 가지 정하기",
        "action_key": "set_today_focus"
      }
    },
    "recovery_card": {
      "stress_signal_key": "OVERPLANNING",
      "title": "잠깐 정리 시간",
      "body": "회복 제안"
    }
  }
}
```

응답 규칙:

- `trajectory_gap_card`는 nullable이며, 최근 행동 데이터와 활성 목표 데이터가 충분할 때만 내려준다
- ETA와 `productivity_ratio`는 최근 행동 데이터 기반 추정치이며, 유형 자체를 계수로 사용해 직접 계산하지 않는다
- 유형 profile은 이 카드의 카피 톤, 숫자 강조 정도, CTA 문구만 제어한다
- 특정 유형의 `forbidden_patterns`에 따라 클라이언트는 숫자보다 요약 문장을 더 크게 노출할 수 있다

### 7.2 `PUT /v1/today-focus`

목적:

- 특정 날짜의 Today Focus를 생성하거나 수정한다

인증:

- 필요

요청:

```json
{
  "local_date": "2026-03-26",
  "title": "오늘 꼭 끝낼 일",
  "note": "설명",
  "linked_task_id": "uuid"
}
```

응답:

```json
{
  "data": {
    "id": "uuid",
    "local_date": "2026-03-26",
    "title": "오늘 꼭 끝낼 일",
    "note": "설명",
    "linked_task_id": "uuid",
    "status": "ACTIVE"
  }
}
```

### 7.3 `GET /v1/plan/today`

목적:

- Today 뷰의 Task와 Today Focus를 조회한다

인증:

- 필요

쿼리 파라미터:

- `local_date`

### 7.4 `GET /v1/plan/week`

목적:

- Week 뷰에서 Task와 CalendarEvent를 함께 조회한다

인증:

- 필요

쿼리 파라미터:

- `week_start`

### 7.5 `GET /v1/plan/backlog`

목적:

- 미배정 Task와 변환 후보 Idea를 조회한다

인증:

- 필요

쿼리 파라미터:

- `cursor`
- `limit`

### 7.6 `POST /v1/tasks/reorder`

목적:

- Today 또는 Plan 목록에서 Task 순서를 저장한다

인증:

- 필요

요청:

```json
{
  "local_date": "2026-03-26",
  "items": [
    {
      "task_id": "uuid-1",
      "sort_order": 10
    },
    {
      "task_id": "uuid-2",
      "sort_order": 20
    }
  ]
}
```

## 8. Quick Capture / Task / Idea API

### 8.1 `POST /v1/capture/analyze`

목적:

- 자유 입력을 기준으로 Task/Idea 추천 라우팅을 계산한다

인증:

- 필요

요청:

```json
{
  "input_text": "다음 주 발표 아이디어 정리",
  "local_date": "2026-03-26"
}
```

응답:

```json
{
  "data": {
    "suggested_target": "IDEA",
    "reason": "exploratory",
    "normalized_title": "다음 주 발표 아이디어 정리"
  }
}
```

노트:

- 이 API는 편의용이며, 클라이언트가 항상 먼저 호출할 필요는 없다

### 8.2 `POST /v1/tasks`

목적:

- Task를 생성한다

인증:

- 필요

요청:

```json
{
  "title": "발표 자료 수정",
  "note": "3페이지부터 다시",
  "source_type": "QUICK_CAPTURE",
  "today_focus_id": "uuid",
  "due_at": "2026-03-26T03:00:00Z",
  "reminder_at": "2026-03-26T02:30:00Z",
  "energy_estimate": 3
}
```

응답:

```json
{
  "data": {
    "id": "uuid",
    "title": "발표 자료 수정",
    "status": "INBOX",
    "today_focus_id": "uuid",
    "due_at": "2026-03-26T03:00:00Z"
  }
}
```

### 8.3 `GET /v1/tasks`

목적:

- Task 목록을 조회한다

인증:

- 필요

쿼리 파라미터:

- `status`
- `local_date`
- `today_focus_id`
- `cursor`
- `limit`

### 8.4 `GET /v1/tasks/{task_id}`

목적:

- Task 상세를 조회한다

인증:

- 필요

### 8.5 `PATCH /v1/tasks/{task_id}`

목적:

- Task를 수정한다

인증:

- 필요

요청 예시:

```json
{
  "title": "발표 자료 최종 수정",
  "note": "결론 슬라이드 추가",
  "status": "PLANNED",
  "today_focus_id": "uuid",
  "due_at": "2026-03-26T04:00:00Z",
  "reminder_at": "2026-03-26T03:30:00Z",
  "energy_estimate": 4
}
```

### 8.6 `POST /v1/tasks/{task_id}/complete`

목적:

- Task를 완료 처리한다

인증:

- 필요

### 8.7 `POST /v1/tasks/{task_id}/reschedule`

목적:

- Task 일정을 다시 잡는다

인증:

- 필요

요청:

```json
{
  "due_at": "2026-03-27T03:00:00Z",
  "local_due_date": "2026-03-27"
}
```

### 8.8 `POST /v1/ideas`

목적:

- Idea를 생성한다

인증:

- 필요

요청:

```json
{
  "title": "다음 주 발표 아이디어 정리",
  "note": "오프닝 구조 다시 생각",
  "tags": ["work", "presentation"]
}
```

### 8.9 `GET /v1/ideas`

목적:

- Idea 목록을 조회한다

인증:

- 필요

쿼리 파라미터:

- `status`
- `cursor`
- `limit`

### 8.10 `GET /v1/ideas/{idea_id}`

목적:

- Idea 상세를 조회한다

인증:

- 필요

### 8.11 `PATCH /v1/ideas/{idea_id}`

목적:

- Idea를 수정하거나 보관한다

인증:

- 필요

요청 예시:

```json
{
  "title": "발표 도입부 아이디어",
  "note": "질문형 오프닝 검토",
  "status": "ARCHIVED",
  "tags": ["presentation"]
}
```

### 8.12 `POST /v1/ideas/{idea_id}/convert-to-task`

목적:

- Idea를 Task로 전환한다

인증:

- 필요

요청:

```json
{
  "today_focus_id": "uuid",
  "due_at": "2026-03-27T03:00:00Z"
}
```

응답:

```json
{
  "data": {
    "idea_id": "uuid",
    "task": {
      "id": "uuid-task",
      "title": "발표 도입부 아이디어",
      "status": "INBOX"
    }
  }
}
```

## 9. Reflect API

### 9.1 `GET /v1/reflect/daily`

목적:

- Reflect 화면에 필요한 집계 데이터와 질문, 회복 제안을 제공한다

인증:

- 필요

쿼리 파라미터:

- `local_date`

응답:

```json
{
  "data": {
    "today_focus": {
      "id": "uuid",
      "local_date": "2026-03-26",
      "title": "핵심 한 가지",
      "status": "ACTIVE"
    },
    "task_summary": {
      "completed_count": 3,
      "incomplete_count": 2
    },
    "mood_energy_check": {
      "id": "uuid",
      "mood_score": 3,
      "energy_score": 2,
      "context": "EVENING"
    },
    "reflection_prompts": [
      {
        "key": "prompt_1",
        "label": "오늘 무엇이 잘 맞았나요?"
      }
    ],
    "mindfulness_recommendation": {
      "id": "uuid",
      "title": "짧은 정리 시간",
      "body": "3분 동안 머릿속을 비워보세요",
      "duration_minutes": 3
    }
  }
}
```

### 9.2 `POST /v1/mood-energy-checks`

목적:

- mood/energy check를 기록한다

인증:

- 필요

요청:

```json
{
  "local_date": "2026-03-26",
  "context": "EVENING",
  "mood_score": 3,
  "energy_score": 2,
  "note": "조금 지침"
}
```

### 9.3 `PUT /v1/reflections/{local_date}`

목적:

- 날짜 단위 reflection을 생성하거나 갱신한다

인증:

- 필요

요청:

```json
{
  "today_focus_id": "uuid",
  "mood_energy_check_id": "uuid",
  "mindfulness_prompt_id": "uuid",
  "completed_summary": "핵심 업무를 마침",
  "carry_forward_note": "나머지는 내일 오전 처리",
  "prompt_answers": {
    "prompt_1": "집중 시간이 좋았다",
    "prompt_2": "오후에는 피로가 컸다"
  }
}
```

응답:

```json
{
  "data": {
    "id": "uuid",
    "local_date": "2026-03-26",
    "submitted_at": "2026-03-26T12:00:00Z"
  }
}
```

## 10. Me / 설정 API

### 10.1 `GET /v1/me`

목적:

- Me 화면에서 사용할 사용자, MBTI profile, 연결 상태를 조회한다

인증:

- 필요

응답:

```json
{
  "data": {
    "user": {
      "id": "uuid",
      "display_name": "홍길동",
      "primary_email": "user@example.com",
      "locale": "ko-KR",
      "timezone": "Asia/Seoul",
      "onboarding_status": "COMPLETED"
    },
    "mbti_profile": {
      "type_code": "INFJ",
      "source": "FINDER_RESULT",
      "is_user_confirmed": true,
      "confidence_score": 0.82,
      "profile_version": "2026-03-v1"
    },
    "calendar_connections": [
      {
        "id": "uuid",
        "provider": "GOOGLE",
        "account_label": "user@gmail.com",
        "status": "ACTIVE"
      }
    ]
  }
}
```

### 10.2 `PATCH /v1/me/preferences`

목적:

- 사용자 알림 및 기본 선호를 수정한다

인증:

- 필요

요청:

```json
{
  "notification_prefs": {
    "enabled": true,
    "quiet_hours": {
      "start": "22:00",
      "end": "07:00"
    }
  }
}
```

## 11. 서버 내부 전용 플로우

모바일 클라이언트가 직접 호출하지 않지만 서버에 필요한 내부 route는 별도로 존재한다.

- provider OAuth callback
- provider token refresh
- scheduled calendar sync job
- webhook 또는 push 기반 calendar change 처리

이 route들은 모바일 계약 문서의 범위 밖이다.

## 12. 열린 계약 메모

- `provider_payload`의 필수 필드는 provider별로 세분화해 후속 문서에서 확정해야 한다
- `type-catalog`와 `result_summary`의 실제 문구 구조는 `type-profile JSON/data model`에서 세분화된다
- `capture/analyze`는 편의 API이므로, 초기 구현에서 제외하고 클라이언트 단순 분기만으로 시작할 수도 있다
- `plan/today`, `plan/week`, `plan/backlog`의 상세 응답 구조는 Flutter 화면 wireframe이 생기면 더 구체화할 수 있다
- background job 방식이 확정되면 `calendar sync` API의 `queued` semantics를 더 명확히 정리해야 한다
