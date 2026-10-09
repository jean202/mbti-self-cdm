# 주 N회 루틴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 요일 대신 "주 N회"로 루틴을 만들고, 이번 주 횟수 달성 여부를 확인할 수 있게 한다.

**Architecture:** 백엔드는 기존 `cadenceType=CUSTOM` + JSON payload `{ timesPerWeek }`를 사용해 마이그레이션 없이 확장하고, 오늘 수행 기록용 `check-today` 엔드포인트와 주간 집계 응답 필드를 추가한다. 앱은 루틴 추가 시트에 모드 전환을, 루틴 타일에 진행률과 [오늘 했음] 버튼을 추가한다.

**Tech Stack:** NestJS 11 + Prisma + Jest(ts-jest) / Flutter 3.47.6 + Riverpod + Dio

**Spec:** `docs/superpowers/specs/2026-10-09-routine-times-per-week-design.md`

## Global Constraints

- 백엔드 작업 경로: `/Users/jean325/work-src/portfolio/archived/mbti-projects/mbti-self-cdm-routine-freq` (브랜치 `feat/routine-times-per-week`, base `origin/main` 8229b6a)
- 앱 작업 경로: `/Users/jean325/work-src/portfolio/archived/mbti-projects/mbti-self-cdm-app` (브랜치 `feat/routine-times-per-week`)
- Flutter: `~/development/flutter-cleanera/bin/flutter` (PATH 미등록)
- N 범위 1~6, 주 경계 사용자 timezone 기준 월~일, 하루 최대 1회 기록(멱등), 목표 초과 허용
- DB 마이그레이션 금지. 요일 루틴 기존 동작 변경 금지(응답에 `null` 필드만 추가)
- 기준선: 백엔드 `provider-verification.service.spec.ts`의 1건 실패는 `origin/main` 기존 문제(범위 밖). 그 외 99건 통과, 앱 71건 통과
- 커밋·push·배포는 사용자 확인 후에만 수행

---

### Task 1: 백엔드 – 주 N회 루틴 생성

**Files:**
- Modify: `src/modules/routines/dto/create-routine.dto.ts`
- Modify: `src/modules/routines/routines.service.ts` (`createRoutine`)
- Create: `src/modules/routines/dto/create-routine.dto.spec.ts`
- Test: `src/modules/routines/routines.service.spec.ts`

**Interfaces:**
- Produces: `CreateRoutineDto { title: string; note?: string; daysOfWeek?: number[]; timesPerWeek?: number; isActive?: boolean }`
- Produces: 저장 형식 `cadenceType: CUSTOM`, `cadencePayloadJson: { timesPerWeek: number }`

- [ ] **Step 1: 실패하는 테스트 작성**

`routines.service.spec.ts` 상단 import에 `BadRequestException` 추가:

```ts
import { BadRequestException } from '@nestjs/common';
```

`describe('RoutinesService', ...)` 안에 추가:

```ts
  describe('createRoutine', () => {
    it('stores times-per-week routines as CUSTOM cadence', async () => {
      const prisma = createMockPrisma();
      const service = new RoutinesService(prisma);

      await service.createRoutine('user-1', { title: '운동하기', timesPerWeek: 3 });

      expect(prisma.routine.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: '운동하기',
          cadenceType: RoutineCadenceType.CUSTOM,
          cadencePayloadJson: { timesPerWeek: 3 },
        }),
      });
    });

    it('keeps weekday routines as WEEKLY cadence', async () => {
      const prisma = createMockPrisma();
      const service = new RoutinesService(prisma);

      await service.createRoutine('user-1', { title: '이불 개기', daysOfWeek: [1, 3] });

      expect(prisma.routine.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          cadenceType: RoutineCadenceType.WEEKLY,
          cadencePayloadJson: { daysOfWeek: [1, 3] },
        }),
      });
    });

    it.each([
      [{ title: '운동하기' }],
      [{ title: '운동하기', daysOfWeek: [] }],
      [{ title: '운동하기', daysOfWeek: [1], timesPerWeek: 3 }],
    ])('rejects unless exactly one cadence is given: %j', async (dto) => {
      const prisma = createMockPrisma();
      const service = new RoutinesService(prisma);

      await expect(service.createRoutine('user-1', dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.routine.create).not.toHaveBeenCalled();
    });
  });
```

`dto/create-routine.dto.spec.ts` 생성:

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateRoutineDto } from './create-routine.dto';

async function errorsFor(payload: Record<string, unknown>) {
  const errors = await validate(plainToInstance(CreateRoutineDto, payload));
  return errors.map((error) => error.property);
}

describe('CreateRoutineDto', () => {
  it('accepts timesPerWeek without daysOfWeek', async () => {
    expect(await errorsFor({ title: '운동하기', timesPerWeek: 3 })).toEqual([]);
  });

  it.each([0, 7, 2.5])('rejects timesPerWeek %p', async (timesPerWeek) => {
    expect(await errorsFor({ title: '운동하기', timesPerWeek })).toEqual([
      'timesPerWeek',
    ]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest src/modules/routines`
Expected: FAIL — `createRoutine`이 CUSTOM을 저장하지 않고 예외도 던지지 않음, DTO에 `timesPerWeek` 검증 없음(TS 타입 오류 포함)

- [ ] **Step 3: 구현**

`create-routine.dto.ts` 전체:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateRoutineDto {
  @ApiProperty({ description: '루틴 제목', example: '아침 10분 명상' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({ description: '설명 및 메모', example: '호흡에 집중하기' })
  @IsString()
  @IsOptional()
  note?: string;

  @ApiPropertyOptional({
    description: '반복할 요일 (0:일 ~ 6:토). timesPerWeek와 둘 중 하나만 지정',
    example: [1, 3, 5],
  })
  @IsArray()
  @IsOptional()
  daysOfWeek?: number[];

  @ApiPropertyOptional({
    description: '요일 없이 주 N회 반복 (1~6). daysOfWeek와 둘 중 하나만 지정',
    example: 3,
    minimum: 1,
    maximum: 6,
  })
  @IsInt()
  @Min(1)
  @Max(6)
  @IsOptional()
  timesPerWeek?: number;

  @ApiPropertyOptional({ description: '활성화 여부', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
```

`routines.service.ts`: import에 `BadRequestException` 추가하고 `createRoutine` 교체:

```ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
```

```ts
  async createRoutine(userId: string, dto: CreateRoutineDto) {
    this.logger.log(`Creating routine for user: ${userId}`);
    const hasDays = Array.isArray(dto.daysOfWeek) && dto.daysOfWeek.length > 0;
    const hasTimesPerWeek = dto.timesPerWeek !== undefined;

    if (hasDays === hasTimesPerWeek) {
      throw new BadRequestException(
        'Provide exactly one of daysOfWeek or timesPerWeek.',
      );
    }

    return this.prisma.routine.create({
      data: {
        userId,
        name: dto.title,
        note: dto.note,
        cadenceType: hasTimesPerWeek
          ? RoutineCadenceType.CUSTOM
          : RoutineCadenceType.WEEKLY,
        isActive: dto.isActive ?? true,
        cadencePayloadJson: (hasTimesPerWeek
          ? { timesPerWeek: dto.timesPerWeek }
          : { daysOfWeek: dto.daysOfWeek }) as Prisma.InputJsonValue,
      },
    });
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest src/modules/routines`
Expected: PASS (기존 3건 + 신규)

- [ ] **Step 5: 커밋 (사용자 확인 후)**

```bash
git add src/modules/routines
git commit -m "feat: 주 N회 루틴 생성 지원"
```

---

### Task 2: 백엔드 – 주간 집계·연속 달성 주 응답

**Files:**
- Modify: `src/modules/routines/routines.service.ts` (`toRoutineResponse` + 헬퍼)
- Test: `src/modules/routines/routines.service.spec.ts`

**Interfaces:**
- Consumes: Task 1의 payload `{ timesPerWeek }`
- Produces: `GET /v1/routines` 항목에 `times_per_week: number | null`, `week_done_count: number | null`, `week_achieved: boolean | null`. 주 N회 루틴의 `streak_count`는 연속 달성 주 수
- Produces: `private timesPerWeekOf(routine: Routine): number | null` (Task 3에서 사용)

- [ ] **Step 1: 실패하는 테스트 작성**

spec 상단 `FRIDAY_ROUTINE` 아래에 추가:

```ts
const TIMES_PER_WEEK_ROUTINE = {
  ...FRIDAY_ROUTINE,
  id: 'routine-2',
  name: '운동하기',
  note: null,
  cadenceType: RoutineCadenceType.CUSTOM,
  cadencePayloadJson: { timesPerWeek: 3 },
};

function routineTask(localDate: string, status: TaskStatus = TaskStatus.DONE) {
  return {
    id: `task-${localDate}`,
    title: '운동하기',
    status,
    sourceType: TaskSourceType.ROUTINE,
    localDueDate: new Date(`${localDate}T00:00:00.000Z`),
    dueAt: new Date(`${localDate}T00:00:00.000Z`),
    completedAt:
      status === TaskStatus.DONE ? new Date(`${localDate}T03:00:00.000Z`) : null,
    createdAt: new Date(`${localDate}T00:00:00.000Z`),
  };
}

function prismaWithTimesPerWeekTasks(tasks: ReturnType<typeof routineTask>[]) {
  return createMockPrisma({
    routine: {
      ...createMockPrisma().routine,
      findMany: jest.fn().mockResolvedValue([TIMES_PER_WEEK_ROUTINE]),
    },
    task: {
      ...createMockPrisma().task,
      findMany: jest.fn().mockResolvedValue(tasks),
    },
  });
}
```

기존 `getRoutines` 테스트의 `expect.objectContaining({...})`에 요일 루틴 null 필드 단언 추가:

```ts
          times_per_week: null,
          week_done_count: null,
          week_achieved: null,
```

`describe('getRoutines', ...)` 안에 추가 (기준 시각 2026-05-29 금요일 KST, 이번 주 = 05-25 월 ~ 05-31 일):

```ts
    it('counts this week (Mon-Sun) and streaks achieved weeks for times-per-week routines', async () => {
      const prisma = prismaWithTimesPerWeekTasks([
        routineTask('2026-05-27'),
        routineTask('2026-05-26', TaskStatus.INBOX),
        routineTask('2026-05-25'),
        routineTask('2026-05-24'),
        routineTask('2026-05-20'),
        routineTask('2026-05-18'),
        routineTask('2026-05-14'),
        routineTask('2026-05-13'),
        routineTask('2026-05-12'),
        routineTask('2026-05-05'),
      ]);
      const service = new RoutinesService(prisma);

      const [routine] = await service.getRoutines('user-1');

      expect(routine).toEqual(
        expect.objectContaining({
          id: 'routine-2',
          times_per_week: 3,
          week_done_count: 2,
          week_achieved: false,
          streak_count: 2,
          is_due_today: false,
          last_completed_local_date: '2026-05-27',
        }),
      );
      expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it('includes the current week in the streak once it is achieved', async () => {
      const prisma = prismaWithTimesPerWeekTasks([
        routineTask('2026-05-28'),
        routineTask('2026-05-27'),
        routineTask('2026-05-25'),
        routineTask('2026-05-24'),
        routineTask('2026-05-20'),
        routineTask('2026-05-18'),
      ]);
      const service = new RoutinesService(prisma);

      const [routine] = await service.getRoutines('user-1');

      expect(routine).toEqual(
        expect.objectContaining({
          week_done_count: 3,
          week_achieved: true,
          streak_count: 2,
        }),
      );
    });

    it('does not count weeks before the routine was created', async () => {
      // 같은 제목의 예전 루틴 기록(05-11 주)이 남아 있어도 생성 주(05-18) 이전은 세지 않는다.
      const prisma = prismaWithTimesPerWeekTasks([
        routineTask('2026-05-27'),
        routineTask('2026-05-26'),
        routineTask('2026-05-25'),
        routineTask('2026-05-20'),
        routineTask('2026-05-19'),
        routineTask('2026-05-18'),
        routineTask('2026-05-13'),
        routineTask('2026-05-12'),
        routineTask('2026-05-11'),
      ]);
      prisma.routine.findMany.mockResolvedValue([
        {
          ...TIMES_PER_WEEK_ROUTINE,
          createdAt: new Date('2026-05-20T00:00:00.000Z'),
        },
      ]);
      const service = new RoutinesService(prisma);

      const [routine] = await service.getRoutines('user-1');

      // 이번 주 + 05-18 주 = 2 (경계가 없으면 05-11 주까지 3)
      expect(routine.streak_count).toBe(2);
    });
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest src/modules/routines`
Expected: FAIL — `times_per_week` 등 필드 없음, `streak_count` 0

- [ ] **Step 3: 구현**

`routines.service.ts`의 `RoutineTaskSource` 타입 아래에 추가:

```ts
type RoutineCadenceRule = { daysOfWeek?: number[]; timesPerWeek?: number };

type WeeklyProgress = {
  doneCount: number;
  achieved: boolean;
  streak: number;
};
```

`toRoutineResponse`를 다음으로 교체:

```ts
  private toRoutineResponse(
    routine: Routine,
    tasks: RoutineTaskSource[],
    localDate: string,
    timezone: string,
  ) {
    const routineTasks = tasks.filter((task) => task.title === routine.name);
    const todayTask = routineTasks.find(
      (task) => this.taskLocalDate(task, timezone) === localDate,
    );
    const lastCompletedTask = routineTasks.find(
      (task) => task.status === TaskStatus.DONE && task.completedAt,
    );
    const lastCompletedLocalDate = lastCompletedTask
      ? this.formatDateInTimezone(
          lastCompletedTask.completedAt ?? lastCompletedTask.dueAt ?? lastCompletedTask.createdAt,
          timezone,
        )
      : null;
    const timesPerWeek = this.timesPerWeekOf(routine);
    const weekly =
      timesPerWeek === null
        ? null
        : this.summarizeWeeks(routine, routineTasks, localDate, timezone, timesPerWeek);

    return {
      id: routine.id,
      name: routine.name,
      note: routine.note,
      cadenceType: routine.cadenceType,
      cadencePayloadJson: routine.cadencePayloadJson,
      isActive: routine.isActive,
      createdAt: routine.createdAt.toISOString(),
      updatedAt: routine.updatedAt.toISOString(),
      last_completed_at: lastCompletedTask?.completedAt?.toISOString() ?? null,
      last_completed_local_date: lastCompletedLocalDate,
      streak_count:
        weekly?.streak ??
        this.calculateStreak(routine, routineTasks, localDate, timezone),
      times_per_week: timesPerWeek,
      week_done_count: weekly?.doneCount ?? null,
      week_achieved: weekly?.achieved ?? null,
      today_task_id: todayTask?.id ?? null,
      today_task_status: todayTask?.status ?? null,
      is_due_today: this.isRoutineDueOn(routine, localDate),
      is_today_generated: Boolean(todayTask),
      is_today_skipped: todayTask?.status === TaskStatus.ARCHIVED,
    };
  }
```

`calculateStreak` 위에 헬퍼 추가:

```ts
  private timesPerWeekOf(routine: Routine): number | null {
    const rule = routine.cadencePayloadJson as RoutineCadenceRule | null;
    const value = rule?.timesPerWeek;

    return typeof value === 'number' && value > 0 ? value : null;
  }

  // 이번 주(월~일) 수행 일수와, 진행 중인 이번 주를 제외하면 끊기지 않는 연속 달성 주 수.
  private summarizeWeeks(
    routine: Routine,
    tasks: RoutineTaskSource[],
    localDate: string,
    timezone: string,
    timesPerWeek: number,
  ): WeeklyProgress {
    const doneDates = new Set<string>();

    for (const task of tasks) {
      const taskDate = task.status === TaskStatus.DONE
        ? this.taskLocalDate(task, timezone)
        : null;

      if (taskDate) {
        doneDates.add(taskDate);
      }
    }

    const countWeek = (weekStart: string) => {
      let count = 0;

      for (let offset = 0; offset < 7; offset++) {
        if (doneDates.has(this.shiftLocalDate(weekStart, offset))) {
          count++;
        }
      }

      return count;
    };

    const firstWeek = this.startOfWeek(
      this.formatDateInTimezone(routine.createdAt, timezone),
    );
    const thisWeek = this.startOfWeek(localDate);
    const doneCount = countWeek(thisWeek);
    const achieved = doneCount >= timesPerWeek;
    let streak = achieved ? 1 : 0;

    for (
      let weekStart = this.shiftLocalDate(thisWeek, -7);
      weekStart >= firstWeek && countWeek(weekStart) >= timesPerWeek;
      weekStart = this.shiftLocalDate(weekStart, -7)
    ) {
      streak++;
    }

    return { doneCount, achieved, streak };
  }

  private startOfWeek(localDate: string): string {
    const mondayOffset = (parseLocalDate(localDate).getUTCDay() + 6) % 7;

    return this.shiftLocalDate(localDate, -mondayOffset);
  }

  private shiftLocalDate(localDate: string, days: number): string {
    const date = parseLocalDate(localDate);
    date.setUTCDate(date.getUTCDate() + days);
    return formatLocalDate(date);
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest src/modules/routines`
Expected: PASS

- [ ] **Step 5: 커밋 (사용자 확인 후)**

```bash
git add src/modules/routines/routines.service.ts src/modules/routines/routines.service.spec.ts
git commit -m "feat: 주 N회 루틴의 주간 수행 횟수와 연속 달성 주 응답"
```

---

### Task 3: 백엔드 – `POST /v1/routines/:routine_id/check-today`

**Files:**
- Modify: `src/modules/routines/routines.service.ts` (`checkTodayRoutine`, `createRoutineTask`)
- Modify: `src/modules/routines/routines.controller.ts`
- Modify: `docs/openapi.json` (`npm run export:openapi`로 재생성, 실패 시 생략하고 보고)
- Test: `src/modules/routines/routines.service.spec.ts`

**Interfaces:**
- Consumes: Task 2의 `timesPerWeekOf`
- Produces: `checkTodayRoutine(userId: string, routineId: string): Promise<{ routine_id: string; task_id: string; local_date: string }>`
- Produces: HTTP `POST /v1/routines/{routine_id}/check-today` (앱 Task 5가 호출)

- [ ] **Step 1: 실패하는 테스트 작성**

spec 상단 import에 `NotFoundException` 추가:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
```

`describe('RoutinesService', ...)` 안에 추가:

```ts
  describe('checkTodayRoutine', () => {
    function prismaForCheck(existingTask: unknown, routine: unknown = TIMES_PER_WEEK_ROUTINE) {
      return createMockPrisma({
        routine: {
          ...createMockPrisma().routine,
          findFirst: jest.fn().mockResolvedValue(routine),
        },
        task: {
          ...createMockPrisma().task,
          findFirst: jest.fn().mockResolvedValue(existingTask),
          update: jest
            .fn()
            .mockResolvedValue({ id: 'task-existing', status: TaskStatus.DONE }),
        },
      });
    }

    it('records today as a done routine task', async () => {
      const prisma = prismaForCheck(null);
      const service = new RoutinesService(prisma);

      const result = await service.checkTodayRoutine('user-1', 'routine-2');

      expect(result).toEqual({
        routine_id: 'routine-2',
        task_id: 'task-new',
        local_date: '2026-05-29',
      });
      expect(prisma.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: '운동하기',
          sourceType: TaskSourceType.ROUTINE,
          status: TaskStatus.DONE,
          completedAt: new Date('2026-05-29T00:30:00.000Z'),
          localDueDate: new Date('2026-05-29T00:00:00.000Z'),
        }),
      });
    });

    it('is idempotent when today is already done', async () => {
      const prisma = prismaForCheck({ id: 'task-existing', status: TaskStatus.DONE });
      const service = new RoutinesService(prisma);

      const result = await service.checkTodayRoutine('user-1', 'routine-2');

      expect(result.task_id).toBe('task-existing');
      expect(prisma.task.create).not.toHaveBeenCalled();
      expect(prisma.task.update).not.toHaveBeenCalled();
    });

    it('marks an existing unfinished task for today as done', async () => {
      const prisma = prismaForCheck({ id: 'task-existing', status: TaskStatus.INBOX });
      const service = new RoutinesService(prisma);

      await service.checkTodayRoutine('user-1', 'routine-2');

      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-existing' },
        data: {
          status: TaskStatus.DONE,
          completedAt: new Date('2026-05-29T00:30:00.000Z'),
        },
      });
    });

    it('rejects weekday routines', async () => {
      const prisma = prismaForCheck(null, FRIDAY_ROUTINE);
      const service = new RoutinesService(prisma);

      await expect(
        service.checkTodayRoutine('user-1', 'routine-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when the routine does not exist', async () => {
      const prisma = prismaForCheck(null, null);
      const service = new RoutinesService(prisma);

      await expect(
        service.checkTodayRoutine('user-1', 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest src/modules/routines`
Expected: FAIL — `checkTodayRoutine is not a function`

- [ ] **Step 3: 구현**

`routines.service.ts`: `skipTodayRoutine` 아래에 추가:

```ts
  async checkTodayRoutine(userId: string, routineId: string) {
    const user = await this.findUserOrThrow(userId);
    const localDate = resolveRequestedLocalDate(undefined, user.timezone);
    const routine = await this.prisma.routine.findFirst({
      where: { id: routineId, userId },
    });

    if (!routine) {
      throw new NotFoundException('Routine was not found.');
    }

    if (this.timesPerWeekOf(routine) === null) {
      throw new BadRequestException(
        'check-today is only available for times-per-week routines.',
      );
    }

    const existingTask = await this.findRoutineTaskForDate(
      userId,
      routine.name,
      localDate,
    );
    let task = existingTask;

    if (!task) {
      task = await this.createRoutineTask(userId, routine, localDate, user.timezone, {
        status: TaskStatus.DONE,
        completedAt: new Date(),
      });
    } else if (task.status !== TaskStatus.DONE) {
      task = await this.prisma.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.DONE, completedAt: new Date() },
      });
    }

    return {
      routine_id: routineId,
      task_id: task.id,
      local_date: localDate,
    };
  }
```

`createRoutineTask` 교체:

```ts
  private async createRoutineTask(
    userId: string,
    routine: Routine,
    localDate: string,
    timezone: string,
    completion: Pick<Prisma.TaskUncheckedCreateInput, 'status' | 'completedAt'> = {},
  ) {
    const range = buildUtcDayRangeForTimezone(localDate, timezone);

    return this.prisma.task.create({
      data: {
        userId,
        title: routine.name,
        note: routine.note,
        sourceType: TaskSourceType.ROUTINE,
        dueAt: range.start,
        localDueDate: parseLocalDate(localDate),
        ...completion,
      },
    });
  }
```

`routines.controller.ts`: `skipTodayRoutine` 아래에 추가:

```ts
  @Post(':routine_id/check-today')
  @ApiOperation({ summary: '주 N회 루틴 오늘 수행 기록' })
  checkTodayRoutine(
    @CurrentUser() user: RequestUser,
    @Param('routine_id', new ParseUUIDPipe()) routineId: string,
  ) {
    return this.routinesService.checkTodayRoutine(user.userId, routineId);
  }
```

- [ ] **Step 4: 통과 확인 + 전체 회귀**

Run: `npx jest src/modules/routines && npx jest && npm run build`
Expected: routines PASS. 전체는 기존 `provider-verification` 1건 실패 외 PASS. build 성공

- [ ] **Step 5: OpenAPI 재생성**

Run: `npm run export:openapi && git diff --stat docs/openapi.json`
Expected: `/v1/routines/{routine_id}/check-today`와 `timesPerWeek` 반영. DB 연결 등으로 실패하면 되돌리고(`git checkout docs/openapi.json`) 보고

- [ ] **Step 6: 커밋 (사용자 확인 후)**

```bash
git add src/modules/routines docs/openapi.json docs/superpowers
git commit -m "feat: 주 N회 루틴 오늘 수행 기록 API 추가"
```

---

### Task 4: 앱 – `RoutineItem` 주 N회 필드 파싱

**Files:**
- Modify: `lib/features/home/domain/home_models.dart` (`RoutineItem`)
- Test: `test/features/home/domain/home_models_test.dart`

**Interfaces:**
- Produces: `RoutineItem.timesPerWeek: int?`, `weekDoneCount: int`, `weekAchieved: bool`, getter `isTimesPerWeek: bool`

- [ ] **Step 1: 실패하는 테스트 작성**

`home_models_test.dart`의 `main()` 끝에 추가:

```dart
  group('RoutineItem.fromJson 주 N회', () {
    test('주 N회 루틴의 횟수와 이번 주 진행을 읽는다', () {
      final routine = RoutineItem.fromJson({
        'id': 'routine-2',
        'name': '운동하기',
        'cadenceType': 'CUSTOM',
        'cadencePayloadJson': {'timesPerWeek': 3},
        'isActive': true,
        'streak_count': 2,
        'times_per_week': 3,
        'week_done_count': 1,
        'week_achieved': false,
        'is_due_today': false,
      });

      expect(routine.isTimesPerWeek, isTrue);
      expect(routine.timesPerWeek, 3);
      expect(routine.weekDoneCount, 1);
      expect(routine.weekAchieved, isFalse);
      expect(routine.daysOfWeek, isEmpty);
    });

    test('요일 루틴은 null 필드를 기본값으로 읽는다', () {
      final routine = RoutineItem.fromJson({
        'id': 'routine-1',
        'name': '이불 개기',
        'cadencePayloadJson': {
          'daysOfWeek': [5],
        },
        'times_per_week': null,
        'week_done_count': null,
        'week_achieved': null,
      });

      expect(routine.isTimesPerWeek, isFalse);
      expect(routine.weekDoneCount, 0);
      expect(routine.weekAchieved, isFalse);
      expect(routine.daysOfWeek, [5]);
    });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `~/development/flutter-cleanera/bin/flutter test test/features/home/domain/home_models_test.dart`
Expected: FAIL — `isTimesPerWeek` 등 getter 없음(컴파일 오류)

- [ ] **Step 3: 구현**

`RoutineItem` 생성자에 `this.isTodaySkipped = false,` 다음 줄로 추가:

```dart
    this.timesPerWeek,
    this.weekDoneCount = 0,
    this.weekAchieved = false,
```

필드 `final bool isTodaySkipped;` 아래에 추가:

```dart
  /// 요일 대신 주 N회로 반복하는 루틴이면 N, 요일 루틴이면 null.
  final int? timesPerWeek;
  final int weekDoneCount;
  final bool weekAchieved;
```

getter `isPendingToday` 아래에 추가:

```dart
  bool get isTimesPerWeek => timesPerWeek != null;
```

`fromJson`에서 `rawDays` 선언 아래에 추가:

```dart
    final rawTimesPerWeek =
        json['times_per_week'] ??
        (payload is Map<String, dynamic> ? payload['timesPerWeek'] : null);
```

`RoutineItem(` 인자 끝(`isTodaySkipped: ...,` 다음)에 추가:

```dart
      timesPerWeek: rawTimesPerWeek == null
          ? null
          : int.tryParse('$rawTimesPerWeek'),
      weekDoneCount: int.tryParse('${json['week_done_count'] ?? 0}') ?? 0,
      weekAchieved: json['week_achieved'] as bool? ?? false,
```

- [ ] **Step 4: 통과 확인**

Run: `~/development/flutter-cleanera/bin/flutter test test/features/home/domain/home_models_test.dart`
Expected: PASS

- [ ] **Step 5: 커밋 (사용자 확인 후)**

```bash
git add lib/features/home/domain/home_models.dart test/features/home/domain/home_models_test.dart
git commit -m "feat: 루틴 응답의 주 N회 필드 파싱"
```

---

### Task 5: 앱 – repository/controller 주 N회 생성·오늘 기록

**Files:**
- Modify: `lib/features/home/data/home_repository.dart` (`createRoutine`, `checkTodayRoutine`)
- Modify: `lib/features/home/home_controller.dart` (`createRoutine`, `checkTodayRoutine`)
- Test: `test/features/home/data/home_repository_test.dart`

**Interfaces:**
- Consumes: 백엔드 Task 1·3의 `timesPerWeek` 필드, `POST /v1/routines/{id}/check-today`
- Produces: `HomeRepository.createRoutine({required String title, String? note, List<int>? daysOfWeek, int? timesPerWeek})`, `HomeRepository.checkTodayRoutine(String routineId)`, `HomeController.checkTodayRoutine(String routineId)` (Task 6에서 사용), `HomeController.createRoutine({required String title, String? note, List<int>? daysOfWeek, int? timesPerWeek})`

- [ ] **Step 1: 실패하는 테스트 작성**

`home_repository_test.dart`의 `FixtureAdapter` 클래스 아래에 추가:

```dart
/// 요청을 기록하고 빈 성공 응답을 돌려주는 어댑터.
class RecordingAdapter implements HttpClientAdapter {
  final List<RequestOptions> requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return ResponseBody.fromString(
      '{"data":{}}',
      201,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
```

`main()` 끝에 추가:

```dart
  group('HomeRepository 루틴 쓰기', () {
    late RecordingAdapter recorder;
    late HomeRepository writer;

    setUp(() {
      recorder = RecordingAdapter();
      writer = HomeRepository(
        Dio(BaseOptions(baseUrl: 'http://test.local'))
          ..httpClientAdapter = recorder,
      );
    });

    test('주 N회 루틴은 timesPerWeek만 보낸다', () async {
      await writer.createRoutine(title: '운동하기', timesPerWeek: 3);

      final request = recorder.requests.single;
      expect(request.path, '/v1/routines');
      expect(request.data, {
        'title': '운동하기',
        'timesPerWeek': 3,
        'isActive': true,
      });
    });

    test('요일 루틴은 daysOfWeek만 보낸다', () async {
      await writer.createRoutine(title: '이불 개기', daysOfWeek: [5]);

      expect(recorder.requests.single.data, {
        'title': '이불 개기',
        'daysOfWeek': [5],
        'isActive': true,
      });
    });

    test('오늘 했음은 check-today로 보낸다', () async {
      await writer.checkTodayRoutine('routine-2');

      final request = recorder.requests.single;
      expect(request.method, 'POST');
      expect(request.path, '/v1/routines/routine-2/check-today');
    });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `~/development/flutter-cleanera/bin/flutter test test/features/home/data/home_repository_test.dart`
Expected: FAIL — `timesPerWeek` 파라미터·`checkTodayRoutine` 없음(컴파일 오류)

- [ ] **Step 3: 구현**

`home_repository.dart`: `skipTodayRoutine` 아래에 추가하고 `createRoutine` 교체:

```dart
  Future<void> checkTodayRoutine(String routineId) async {
    await _dio.post('/v1/routines/$routineId/check-today');
  }

  Future<void> createRoutine({
    required String title,
    String? note,
    List<int>? daysOfWeek,
    int? timesPerWeek,
  }) async {
    await _dio.post(
      '/v1/routines',
      data: {
        'title': title,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
        if (timesPerWeek != null)
          'timesPerWeek': timesPerWeek
        else
          'daysOfWeek': daysOfWeek ?? const <int>[],
        'isActive': true,
      },
    );
  }
```

`home_controller.dart`: `skipTodayRoutine` 아래에 추가하고 `createRoutine` 교체:

```dart
  Future<void> checkTodayRoutine(String routineId) async {
    await _repository.checkTodayRoutine(routineId);
    await refresh();
  }

  Future<void> createRoutine({
    required String title,
    String? note,
    List<int>? daysOfWeek,
    int? timesPerWeek,
  }) async {
    await _repository.createRoutine(
      title: title,
      note: note,
      daysOfWeek: daysOfWeek,
      timesPerWeek: timesPerWeek,
    );
    await refresh();
  }
```

- [ ] **Step 4: 통과 확인**

Run: `~/development/flutter-cleanera/bin/flutter test test/features/home/data/home_repository_test.dart`
Expected: PASS

- [ ] **Step 5: 커밋 (사용자 확인 후)**

```bash
git add lib/features/home/data/home_repository.dart lib/features/home/home_controller.dart test/features/home/data/home_repository_test.dart
git commit -m "feat: 주 N회 루틴 생성과 오늘 기록 API 연결"
```

---

### Task 6: 앱 – 루틴 추가 시트·루틴 타일 UI

**Files:**
- Modify: `lib/features/home/home_screen.dart` (`_RoutineSection` 빈 상태 문구, `_RoutineTile`, `_showCreateRoutineSheet`, 파일 끝에 `_RoutineCadence` enum)

**Interfaces:**
- Consumes: Task 4의 `RoutineItem.isTimesPerWeek/timesPerWeek/weekDoneCount/weekAchieved`, Task 5의 `HomeController.checkTodayRoutine`, `createRoutine(daysOfWeek:, timesPerWeek:)`

- [ ] **Step 1: 빈 상태 문구**

`_RoutineSection`의 `body: '요일을 골라 반복할 일을 만들어두세요.',`를 다음으로 교체:

```dart
              body: '요일이나 주 몇 회로 반복할 일을 만들어두세요.',
```

- [ ] **Step 2: 루틴 타일**

`_RoutineTile.build`의 `subtitle` `Wrap`의 `children: [...]`를 다음으로 교체:

```dart
          children: routine.isTimesPerWeek
              ? [
                  Text('주 ${routine.timesPerWeek}회'),
                  Text(
                    '이번 주 ${routine.weekDoneCount}/${routine.timesPerWeek}'
                    '${routine.weekAchieved ? ' 달성' : ''}',
                  ),
                  Text('${routine.streakCount}주 연속 달성'),
                  Text('마지막 ${_formatRoutineLastDone(routine)}'),
                ]
              : [
                  Text(_formatWeekdays(routine.daysOfWeek)),
                  Text('연속 ${routine.streakCount}회'),
                  Text('마지막 ${_formatRoutineLastDone(routine)}'),
                  if (routine.isDueToday && routine.isTodayGenerated)
                    const Text('오늘 자동 생성'),
                  if (routine.isSkippedToday) const Text('건너뜀'),
                ],
```

`trailing: routine.isPendingToday`를 다음으로 교체(기존 `? Row(...) : Icon(...)`는 그대로 뒤에 둔다):

```dart
      trailing: routine.isTimesPerWeek
          ? _buildTimesPerWeekAction(context, ref)
          : routine.isPendingToday
```

`_RoutineTile` 클래스 안(`build` 아래)에 추가:

```dart
  Widget _buildTimesPerWeekAction(BuildContext context, WidgetRef ref) {
    if (routine.isDoneToday) {
      return Icon(Icons.check_circle, color: AppColors.mintDark);
    }

    return TextButton.icon(
      icon: const Icon(Icons.check),
      label: const Text('오늘 했음'),
      onPressed: () async {
        await ref
            .read(homeControllerProvider.notifier)
            .checkTodayRoutine(routine.id);
        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('"${routine.title}" 오늘 기록했습니다.')),
        );
      },
    );
  }
```

- [ ] **Step 3: 루틴 추가 시트**

파일 끝(`_weekdayLabel` 근처)에 추가:

```dart
enum _RoutineCadence { days, timesPerWeek }
```

`_showCreateRoutineSheet`의 `final selectedDays = ...;` 아래에 추가:

```dart
  var cadence = _RoutineCadence.days;
  var timesPerWeek = 3;
```

메모 `TextField` 다음의 `const SizedBox(height: 12),` + 요일 `Wrap(...)` 블록을 다음으로 교체:

```dart
                const SizedBox(height: 12),
                SegmentedButton<_RoutineCadence>(
                  segments: const [
                    ButtonSegment(
                      value: _RoutineCadence.days,
                      label: Text('요일 지정'),
                    ),
                    ButtonSegment(
                      value: _RoutineCadence.timesPerWeek,
                      label: Text('주 N회'),
                    ),
                  ],
                  selected: {cadence},
                  onSelectionChanged: (selection) {
                    setSheetState(() => cadence = selection.first);
                  },
                ),
                const SizedBox(height: 12),
                if (cadence == _RoutineCadence.days)
                  Wrap(
                    spacing: 8,
                    children: List.generate(7, (index) {
                      final selected = selectedDays.contains(index);
                      return FilterChip(
                        label: Text(_weekdayLabel(index)),
                        selected: selected,
                        onSelected: (value) {
                          setSheetState(() {
                            if (value) {
                              selectedDays.add(index);
                            } else if (selectedDays.length > 1) {
                              selectedDays.remove(index);
                            }
                          });
                        },
                      );
                    }),
                  )
                else
                  Wrap(
                    spacing: 8,
                    children: [
                      for (var count = 1; count <= 6; count++)
                        ChoiceChip(
                          label: Text('주 $count회'),
                          selected: timesPerWeek == count,
                          onSelected: (_) {
                            setSheetState(() => timesPerWeek = count);
                          },
                        ),
                    ],
                  ),
```

저장 버튼의 `createRoutine(` 인자를 다음으로 교체:

```dart
                          title: title,
                          note: noteController.text,
                          daysOfWeek: cadence == _RoutineCadence.days
                              ? (selectedDays.toList()..sort())
                              : null,
                          timesPerWeek: cadence == _RoutineCadence.timesPerWeek
                              ? timesPerWeek
                              : null,
```

- [ ] **Step 4: 정적 분석 + 전체 테스트**

Run: `~/development/flutter-cleanera/bin/flutter analyze lib/features/home && ~/development/flutter-cleanera/bin/flutter test`
Expected: 신규 경고/오류 없음, 전체 PASS

- [ ] **Step 5: 커밋 (사용자 확인 후)**

```bash
git add lib/features/home/home_screen.dart
git commit -m "feat: 주 N회 루틴 추가 시트와 진행률 타일"
```

---

### Task 7: 배포·실기기 검증 (각 단계 사용자 확인)

- [ ] **Step 1:** 백엔드 브랜치 push → PR(`feat/routine-times-per-week` → `main`) 생성
- [ ] **Step 2:** 사용자 merge 승인 후 merge → Railway 배포 대기
- [ ] **Step 3:** 운영 확인
  - `curl -s https://mbti-self-cdm-production.up.railway.app/docs-json`에 `/v1/routines/{routine_id}/check-today` 존재
  - `/v1/health` 200
- [ ] **Step 4:** 앱 release 빌드·설치

```bash
cd /Users/jean325/work-src/portfolio/archived/mbti-projects/mbti-self-cdm-app
~/development/flutter-cleanera/bin/flutter build ios --release
xcrun devicectl device install app --device 00008120-00012C2C3663C01E build/ios/iphoneos/Runner.app
```

- [ ] **Step 5:** 사용자 실기기 확인: 주 3회 루틴 생성 → [오늘 했음] → `이번 주 1/3`, 체크 아이콘 표시
- [ ] **Step 6:** 앱 SDK 마이그레이션 파일·CLAUDE.md는 별도 `chore` 커밋으로 분리(사용자 확인 후)
