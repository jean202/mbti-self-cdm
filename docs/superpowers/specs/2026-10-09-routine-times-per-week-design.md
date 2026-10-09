# 주 N회 루틴 (times-per-week) 설계

- 작성일: 2026-10-09
- 대상: 백엔드 `mbti-self-cdm` (브랜치 `feat/routine-times-per-week`, base `origin/main` 8229b6a), 앱 `mbti-self-cdm-app` (브랜치 `feat/routine-times-per-week`, base `fix/splash-before-auth`)

## 배경

루틴은 요일(`daysOfWeek`)로만 만들 수 있다. P 성향 사용자는 "일주일에 3번"처럼 요일 없이 횟수만 정하고, 그 횟수를 채웠는지 확인하고 싶어 한다.

## 결정 사항

| 항목 | 결정 |
| --- | --- |
| 저장 방식 | 기존 `cadenceType = CUSTOM` + `cadencePayloadJson = { timesPerWeek: N }`. DB 마이그레이션 없음 |
| N 범위 | 1~6 (매일은 기존 요일 루틴 사용) |
| 주 경계 | 사용자 timezone 기준 **월~일** |
| 하루 동작 | 할 일 자동 생성 없음. 루틴 카드에 진행률 + [오늘 했음] 버튼 |
| 하루 기록 횟수 | 하루 최대 1회 (같은 날 재요청은 멱등) |
| 목표 초과 | 허용 (예: 4/3) |
| 연속 기록 | 연속 달성 주 수. 진행 중인 이번 주가 미달성이어도 끊지 않음 |

## 백엔드

### `POST /v1/routines`
- DTO: `daysOfWeek` 선택으로 변경, `timesPerWeek`(선택, 정수 1~6) 추가.
- 서비스: `daysOfWeek`(비어 있지 않은 배열)와 `timesPerWeek` 중 **정확히 하나**가 아니면 400.
- `timesPerWeek` → `cadenceType: CUSTOM`, payload `{ timesPerWeek }`. 그 외는 기존과 동일(`WEEKLY`, `{ daysOfWeek }`).

### `POST /v1/routines/:routine_id/check-today` (신규)
- 주 N회 루틴이 아니면 400, 없으면 404.
- 오늘(사용자 timezone) 같은 제목의 ROUTINE 할 일이 있으면:
  - DONE이면 그대로 반환(멱등).
  - 아니면 DONE + `completedAt`으로 갱신.
- 없으면 `status: DONE`, `completedAt: now`, `sourceType: ROUTINE`, `localDueDate`, `dueAt`으로 생성.
- 응답: `{ routine_id, task_id, local_date }`.
- DONE ROUTINE 할 일로 남기므로 기존 완료 통계·회고(`completedRoutineCount` 등)에 그대로 집계된다.

### `GET /v1/routines` 응답 추가 필드
- `times_per_week`: 주 N회 루틴이면 N, 아니면 `null`.
- `week_done_count`: 이번 주(월~일) DONE 기록이 있는 날짜 수. 요일 루틴은 `null`.
- `week_achieved`: `week_done_count >= times_per_week`. 요일 루틴은 `null`.
- `streak_count`: 주 N회 루틴은 연속 달성 주 수(이번 주 미달성은 건너뛰고, 그 이전 주부터 미달성 주를 만나면 중단, 루틴 생성 주 이전으로는 가지 않음).
- `is_due_today`: 주 N회 루틴은 항상 `false` → 자동 생성(`ensureTodayTasks`)과 오늘 진행률 집계에서 제외. 기존 로직(`daysOfWeek` 없으면 false)으로 자연히 충족.

### 기존 동작 보존
- 요일 루틴의 생성·자동 생성·건너뛰기·연속 기록·응답은 변경 없음. 추가 필드만 `null`로 붙는다.
- `skip-today`는 주 N회 루틴에 `not_due_today`를 반환(기존 로직 그대로).

## 앱

- `RoutineItem`: `timesPerWeek`(int?), `weekDoneCount`(int), `weekAchieved`(bool) 파싱, `isTimesPerWeek` getter.
- `HomeRepository`/`HomeController`: `createRoutine`에 `timesPerWeek` 추가(요일과 택일), `checkTodayRoutine(routineId)` 추가.
- 루틴 추가 시트: 상단 `요일 지정 | 주 N회` 전환. 주 N회는 1~6 선택(기본 3).
- 루틴 타일(주 N회):
  - 부제: `주 3회 · 이번 주 1/3 · 2주 연속 달성 · 마지막 …`, 달성 시 `이번 주 달성` 표시.
  - 오른쪽: 오늘 미기록이면 [오늘 했음] 버튼, 기록했으면 체크 아이콘.
- 요일 루틴 UI와 오늘 진행률 카드는 변경 없음(주 N회 루틴은 `is_due_today=false`라 자동 제외).

## 배포 순서

1. 백엔드 브랜치 push → PR → `main` merge → Railway 배포 (각 단계 사용자 확인).
2. 운영 `/docs-json`에 `check-today` 경로 확인.
3. 앱 release 빌드·설치 → 사용자 확인.
4. 백엔드 로컬 브랜치 `fix/local-dev-verification`로의 반영은 별도 결정.

## 테스트

- 백엔드 `routines.service.spec.ts`:
  - 주 N회 루틴 생성(CUSTOM payload), 둘 다/둘 다 없음 400
  - 월요일 경계 주간 집계, `week_achieved`
  - check-today 신규 생성 / 기존 DONE 멱등 / 요일 루틴 400
  - 연속 달성 주 계산(이번 주 미달성 시 미중단)
  - 자동 생성 제외
- 앱: `RoutineItem.fromJson` 신규 필드 파싱, repository의 `createRoutine(timesPerWeek)` 요청 본문과 `checkTodayRoutine` 경로. 기존 테스트 전체 통과.

## 범위 밖

- 루틴 수정/삭제, 오늘 기록 취소, 요일 루틴의 [오늘 했음] 지원.
- 루틴-할 일 연결을 제목 매칭에서 ID로 바꾸는 리팩터링(기존 방식을 따른다).
