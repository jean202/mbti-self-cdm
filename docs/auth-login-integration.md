# Auth Login Integration

마지막 업데이트: 2026-03-27

## 1. 목적

- Flutter 앱과 NestJS 서버 사이의 실제 소셜 로그인 연동 기준을 고정한다
- 개발용 identity bridge에서 실제 provider `id_token` 검증 모드로 전환하는 절차를 정리한다

## 2. 현재 서버 기준

- 로그인 엔드포인트: `POST /v1/auth/social/login`
- 운영 경로:
  - Flutter SDK가 provider 로그인 완료 후 `id_token`을 서버에 전달
  - 서버는 provider OIDC discovery / JWKS를 조회해 `id_token` 시그니처와 claim을 검증
  - 검증된 `sub`를 `auth_identities.provider_user_id`로 사용한다
- 개발 경로:
  - `AUTH_ENABLE_DEV_IDENTITY_BRIDGE=true`일 때만 `provider_user_id` 또는 `provider_email`로 우회 로그인 가능

## 3. 서버 환경 변수

필수:

- `AUTH_ACCESS_TOKEN_SECRET`
- `AUTH_GOOGLE_CLIENT_IDS`
- `AUTH_APPLE_CLIENT_IDS`
- `AUTH_KAKAO_CLIENT_IDS`
- `AUTH_NAVER_CLIENT_IDS`

노트:

- 각 `*_CLIENT_IDS`는 쉼표 구분 문자열을 허용한다
- iOS / Android / Web client id가 서로 다르면 모두 넣는다
- 운영 전환 시 `AUTH_ENABLE_DEV_IDENTITY_BRIDGE=false`로 변경한다

예시:

```env
AUTH_ENABLE_DEV_IDENTITY_BRIDGE=false
AUTH_GOOGLE_CLIENT_IDS="google-ios-client-id,google-android-client-id"
AUTH_APPLE_CLIENT_IDS="com.example.app"
AUTH_KAKAO_CLIENT_IDS="kakao-native-app-key"
AUTH_NAVER_CLIENT_IDS="naver-client-id"
```

## 4. Flutter 요청 payload 기준

기본 shape:

```json
{
  "provider": "GOOGLE",
  "provider_payload": {
    "id_token": "provider-id-token",
    "nonce": "optional-nonce"
  },
  "device": {
    "device_id": "device-123",
    "platform": "IOS",
    "app_version": "1.0.0"
  }
}
```

필드 규칙:

- `id_token`
  - 운영 경로의 기본 입력값
- `nonce`
  - Flutter에서 nonce를 생성해 provider SDK에 넘긴 경우 같은 값을 서버에도 전달한다
  - Apple은 nonce를 강하게 권장한다
- `authorization_code`
  - 현재 서버에서는 아직 exchange를 구현하지 않았다
  - 보내면 `AUTH_CODE_EXCHANGE_NOT_IMPLEMENTED` 에러를 반환한다

## 5. Provider 메모

### 5.1 Google

- Flutter SDK에서 `idToken`을 받아 서버로 전달
- 서버는 Google OIDC discovery와 JWKS를 사용해 검증

### 5.2 Apple

- Flutter에서 Sign in with Apple 수행 후 `identityToken`을 서버로 전달
- 서버는 Apple OIDC discovery와 JWKS를 사용해 검증
- 첫 로그인 이후에는 email/name이 항상 다시 오지 않을 수 있으므로, 서버는 최초 저장값을 유지하는 방식으로 다룬다

### 5.3 Kakao

- OpenID Connect를 활성화한 뒤 `id_token`을 서버로 전달하는 방식이 기준
- 서버는 Kakao OIDC discovery와 JWKS를 사용해 검증

### 5.4 Naver

- OpenID Connect를 사용하는 경우 `id_token`을 서버로 전달
- 서버는 Naver OIDC discovery와 JWKS를 사용해 검증
- OIDC 미사용 OAuth profile API 기반 로그인은 현재 서버 기준 경로에 포함하지 않는다

## 6. 전환 순서

1. 각 provider 개발자 콘솔에서 client id를 확정한다
2. 서버 `.env`에 `AUTH_*_CLIENT_IDS`를 채운다
3. Flutter SDK가 `id_token`을 받도록 설정한다
4. `AUTH_ENABLE_DEV_IDENTITY_BRIDGE=false`로 변경한다
5. 실제 디바이스 또는 시뮬레이터에서 `POST /v1/auth/social/login`을 검증한다

## 7. 현재 검증 범위

- `JWT + Redis session + refresh rotation` 동작 확인 완료
- provider verifier의 `RS256 id_token` 검증 로직은 로컬 생성 토큰 기준 스크립트 검증 추가
- 실제 외부 provider와의 end-to-end 검증은 각 client id 준비 후 별도 수행 필요
