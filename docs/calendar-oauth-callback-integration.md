# Calendar OAuth Callback Integration

마지막 업데이트: 2026-08-25

## 1. 목적

- Flutter 앱과 NestJS 서버 사이의 Google Calendar OAuth 연동 흐름을 고정한다
- 서버가 브라우저를 앱으로 돌려보내는 방식(딥링크)과, 성공/실패 시 전달되는 `error_code` 계약을 정리한다

## 2. 전체 흐름

1. 앱이 `POST /v1/calendar/connections/oauth/start`를 호출한다.
   - body: `{ provider: "GOOGLE", redirect_uri: "<앱의 커스텀 스킴 딥링크>" }`
   - `redirect_uri`는 **Google Cloud Console에 등록하는 콜백 URL이 아니다.** OAuth 완료 후 서버가 브라우저를 돌려보낼, 앱이 처리할 수 있는 딥링크여야 한다. 예: `mbtiselfcdm://calendar/callback`
   - 응답으로 `authorize_url`을 받아 외부 브라우저로 연다.
2. 사용자가 Google 로그인/권한 승인 화면을 통과한다.
3. Google이 `GET /v1/internal/calendar/oauth/{provider}/callback?state=...&code=...`(또는 실패 시 `error`, `error_description`)로 리다이렉트한다.
   - 이 URL은 Google Cloud Console에 등록된 값과 정확히 일치해야 하며, `CALENDAR_GOOGLE_CALLBACK_URI` 환경 변수(없으면 `API_BASE_URL` 기반 기본값)로 서버가 계산한다.
   - `/oauth/start`에서 앱이 보낸 `redirect_uri`와는 별개의 값이다.
4. 서버가 `code`를 토큰으로 교환하고 `CalendarConnection`을 저장한 뒤, **HTTP 302로 앱의 `redirect_uri`(1번에서 보낸 값)로 리다이렉트**한다. HTML 성공 페이지는 렌더링하지 않는다.
5. 앱은 딥링크로 이 리다이렉트를 수신해 쿼리 파라미터로 성공/실패를 판별한다.

## 3. 딥링크 쿼리 파라미터 계약

리다이렉트 대상은 고정값이 아니라, 1번에서 앱이 보낸 `redirect_uri`를 그대로 사용하고 아래 쿼리만 덧붙인다. (`calendar.service.ts`의 `buildOAuthRedirectResult` / `buildClientRedirectUri`)

성공:

| 파라미터 | 값 |
|---|---|
| `calendar_oauth_status` | `success` |
| `provider` | `GOOGLE` |
| `flow_id` | OAuth flow uuid |
| `connection_id` | 생성/갱신된 `CalendarConnection.id` |

실패:

| 파라미터 | 값 |
|---|---|
| `calendar_oauth_status` | `failed` |
| `provider` | `GOOGLE` |
| `flow_id` | OAuth flow uuid |
| `error_code` | 아래 4절 A군 참고 |
| `error_description` | 사람이 읽을 수 있는 설명 |

값이 없는 파라미터는 URL에서 생략된다.

## 4. error_code 카탈로그

### A. 딥링크로 전달됨 (앱이 처리 가능)

| error_code | 발생 조건 | error_description 예시 |
|---|---|---|
| `CALENDAR_OAUTH_DENIED` | 사용자가 Google 동의 화면에서 거부(`error` 쿼리 수신) | Google이 보낸 값, 없으면 `Provider returned {error}.` |
| `CALENDAR_OAUTH_NOT_SUPPORTED` | `:provider`가 `GOOGLE`이 아니어서 미지원 | `{provider} calendar OAuth callback is not supported yet.` |
| `CALENDAR_ONBOARDING_NOT_READY` | 유저의 onboarding 상태가 `AUTH_ONLY`/`MBTI_PENDING` (MBTI 확정 전 연동 시도) | `Calendar connection is available only after MBTI confirmation.` |
| `CALENDAR_OAUTH_CODE_REQUIRED` | 콜백 쿼리에 `code`가 없고 dev bridge도 꺼져 있음 | `Provider callback did not include an authorization code.` |
| `TOKEN_EXCHANGE_FAILED` | Google과의 `code`↔`token` 교환 자체가 실패 | `Failed to exchange authorization code for tokens.` |

이 5개는 302 리다이렉트이므로 HTTP 상태 자체는 의미가 없고, `calendar_oauth_status=failed` + `error_code`로 판별한다.

### B. Raw JSON 에러 (딥링크가 오지 않음)

| error_code | HTTP | 발생 조건 |
|---|---|---|
| `INVALID_CALENDAR_OAUTH_STATE` | 400 | Redis에 `state`(flow_id) 키가 없음 — TTL 만료(기본 600초, `CALENDAR_OAUTH_STATE_TTL_SECONDS`) 또는 위조된 값 |
| `INVALID_CALENDAR_OAUTH_STATE` | 400 | 저장된 state의 JSON이 깨졌거나 필드 누락 |
| `CALENDAR_OAUTH_PROVIDER_MISMATCH` | 400 | URL의 `:provider`와 저장된 state의 provider가 다름 |
| *(code 없음)* | 404 | state는 유효한데 `state.user_id`에 해당하는 유저가 없음 (`User was not found.`) |
| *(code 없음)* | 400 | `/oauth/start` 시점에 `:provider`가 `GOOGLE`이 아님 (`{provider} calendar OAuth start is not supported yet.`) |

B군이 딥링크로 안 오는 이유: 이 시점엔 앱의 `redirect_uri` 자체를 아직 못 읽었거나 신뢰할 수 없어서, 서버가 어디로 돌려보내야 할지 모른다. 그래서 인앱 브라우저에 JSON이 그대로 노출된다.

## 5. 앱 구현 가이드

1. `/oauth/start`의 `redirect_uri`에 앱의 커스텀 스킴 딥링크를 넣는다. Google 콘솔에 등록한 백엔드 콜백 URL을 넣지 않는다 — 그렇게 하면 `state` 파라미터 없이 같은 콜백 라우트가 재호출되어 `ValidationPipe`에서 400으로 실패한다.
2. iOS `Info.plist` / Android `AndroidManifest.xml`에 해당 스킴을 등록하고 딥링크 핸들러를 붙인다.
3. 딥링크 수신 시 `calendar_oauth_status`로 성공/실패를 나누고, 성공이면 `connection_id`, 실패면 `error_code`/`error_description`을 사용한다.
4. B군(딥링크 자체가 안 오는 경우)에 대비해, 브라우저를 연 뒤 일정 시간(예: TTL과 맞춰 90~120초) 안에 딥링크가 안 돌아오면 타임아웃 UI로 처리한다.
