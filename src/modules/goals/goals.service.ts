import { Injectable, NotFoundException } from '@nestjs/common';
import {
  GoalHorizon,
  GoalStatus,
  Prisma,
  type Goal,
} from '@prisma/client';

import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';

type PaceStatus =
  | 'NOT_STARTED'
  | 'AHEAD'
  | 'ON_TRACK'
  | 'BEHIND'
  | 'COMPLETED'
  | 'NO_TARGET_DATE';

@Injectable()
export class GoalsService {
  constructor(private readonly prismaService: PrismaService) {}

  async listGoals(userId: string) {
    const goals = await this.prismaService.goal.findMany({
      where: {
        userId,
        status: {
          not: GoalStatus.ARCHIVED,
        },
      },
      orderBy: [
        { status: 'asc' },
        { horizon: 'asc' },
        { targetDate: 'asc' },
        { updatedAt: 'desc' },
      ],
    });

    const items = goals.map((goal) => this.toGoalResponse(goal));

    return {
      items,
      summary: this.buildSummary(items),
    };
  }

  async createGoal(userId: string, input: CreateGoalDto) {
    const goal = await this.prismaService.goal.create({
      data: {
        userId,
        title: input.title.trim(),
        note: input.note?.trim() || null,
        horizon: input.horizon,
        targetValue: new Prisma.Decimal(input.target_value),
        currentValue: new Prisma.Decimal(input.current_value ?? 0),
        unit: input.unit?.trim() || '개',
        startDate: this.parseDateOnly(input.start_date) ?? this.todayDateOnly(),
        targetDate: this.parseDateOnly(input.target_date),
      },
    });

    return this.toGoalResponse(goal);
  }

  async updateGoal(userId: string, goalId: string, input: UpdateGoalDto) {
    const existing = await this.prismaService.goal.findFirst({
      where: {
        id: goalId,
        userId,
      },
    });

    if (!existing) {
      throw new NotFoundException('Goal was not found.');
    }

    const data: Prisma.GoalUpdateInput = {};

    if (input.title !== undefined) {
      data.title = input.title.trim();
    }

    if (input.note !== undefined) {
      data.note = input.note?.trim() || null;
    }

    if (input.horizon !== undefined) {
      data.horizon = input.horizon;
    }

    if (input.target_value !== undefined) {
      data.targetValue = new Prisma.Decimal(input.target_value);
    }

    if (input.current_value !== undefined) {
      data.currentValue = new Prisma.Decimal(input.current_value);
    }

    if (input.unit !== undefined) {
      data.unit = input.unit.trim() || '개';
    }

    if (input.start_date !== undefined) {
      data.startDate = this.parseDateOnly(input.start_date) ?? existing.startDate;
    }

    if (input.target_date !== undefined) {
      data.targetDate = input.target_date
        ? this.parseDateOnly(input.target_date)
        : null;
    }

    if (input.status !== undefined) {
      data.status = input.status;
      data.completedAt =
        input.status === GoalStatus.COMPLETED
          ? existing.completedAt ?? new Date()
          : null;
    }

    const goal = await this.prismaService.goal.update({
      where: {
        id: goalId,
      },
      data,
    });

    return this.toGoalResponse(goal);
  }

  private toGoalResponse(goal: Goal) {
    const targetValue = Number(goal.targetValue);
    const currentValue = Number(goal.currentValue);
    const progress = this.calculateProgress(goal);

    return {
      id: goal.id,
      title: goal.title,
      note: goal.note,
      horizon: goal.horizon,
      status: goal.status,
      target_value: targetValue,
      current_value: currentValue,
      unit: goal.unit,
      start_date: this.formatDateOnly(goal.startDate),
      target_date: goal.targetDate ? this.formatDateOnly(goal.targetDate) : null,
      completed_at: goal.completedAt?.toISOString() ?? null,
      progress,
      created_at: goal.createdAt.toISOString(),
      updated_at: goal.updatedAt.toISOString(),
    };
  }

  private calculateProgress(goal: Goal) {
    const now = this.todayDateOnly();
    const targetValue = Math.max(Number(goal.targetValue), 0.01);
    const currentValue = Math.max(Number(goal.currentValue), 0);
    const rawRatio = currentValue / targetValue;
    const ratio = Math.min(rawRatio, 1);
    const remainingValue = Math.max(targetValue - currentValue, 0);
    const elapsedDays = Math.max(1, this.daysBetween(goal.startDate, now));
    const dailyRate = currentValue > 0 ? currentValue / elapsedDays : 0;
    const projectedCompletionDate =
      dailyRate > 0
        ? this.addDays(goal.startDate, Math.ceil(targetValue / dailyRate))
        : null;
    const targetDate = goal.targetDate;
    const paceStatus = this.resolvePaceStatus({
      currentValue,
      targetValue,
      projectedCompletionDate,
      targetDate,
      goalStatus: goal.status,
    });
    const targetDeltaDays =
      projectedCompletionDate && targetDate
        ? this.daysBetween(targetDate, projectedCompletionDate)
        : null;

    return {
      ratio,
      percent: Math.round(ratio * 100),
      remaining_value: Number(remainingValue.toFixed(2)),
      elapsed_days: elapsedDays,
      daily_rate: Number(dailyRate.toFixed(2)),
      projected_completion_date: projectedCompletionDate
        ? this.formatDateOnly(projectedCompletionDate)
        : null,
      target_delta_days: targetDeltaDays,
      pace_status: paceStatus,
    };
  }

  private resolvePaceStatus(input: {
    currentValue: number;
    targetValue: number;
    projectedCompletionDate: Date | null;
    targetDate: Date | null;
    goalStatus: GoalStatus;
  }): PaceStatus {
    if (
      input.goalStatus === GoalStatus.COMPLETED ||
      input.currentValue >= input.targetValue
    ) {
      return 'COMPLETED';
    }

    if (input.currentValue <= 0 || !input.projectedCompletionDate) {
      return 'NOT_STARTED';
    }

    if (!input.targetDate) {
      return 'NO_TARGET_DATE';
    }

    const deltaDays = this.daysBetween(
      input.targetDate,
      input.projectedCompletionDate,
    );

    if (deltaDays <= -3) {
      return 'AHEAD';
    }

    if (deltaDays >= 3) {
      return 'BEHIND';
    }

    return 'ON_TRACK';
  }

  private buildSummary(
    goals: Array<ReturnType<GoalsService['toGoalResponse']>>,
  ) {
    const activeGoals = goals.filter((goal) => goal.status === GoalStatus.ACTIVE);
    const completedGoals = goals.filter(
      (goal) => goal.status === GoalStatus.COMPLETED,
    );
    const averageProgress =
      activeGoals.length === 0
        ? 0
        : Math.round(
            activeGoals.reduce((sum, goal) => sum + goal.progress.percent, 0) /
              activeGoals.length,
          );

    return {
      active_count: activeGoals.length,
      completed_count: completedGoals.length,
      average_progress_percent: averageProgress,
      behind_count: activeGoals.filter(
        (goal) => goal.progress.pace_status === 'BEHIND',
      ).length,
    };
  }

  private parseDateOnly(value?: string | null) {
    if (!value) {
      return null;
    }

    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  }

  private todayDateOnly() {
    return this.parseDateOnly(new Date().toISOString().slice(0, 10))!;
  }

  private formatDateOnly(value: Date) {
    return value.toISOString().slice(0, 10);
  }

  private daysBetween(start: Date, end: Date) {
    const millisPerDay = 24 * 60 * 60 * 1000;
    const startDate = this.parseDateOnly(this.formatDateOnly(start))!;
    const endDate = this.parseDateOnly(this.formatDateOnly(end))!;

    return Math.floor((endDate.getTime() - startDate.getTime()) / millisPerDay);
  }

  private addDays(date: Date, days: number) {
    const result = this.parseDateOnly(this.formatDateOnly(date))!;
    result.setUTCDate(result.getUTCDate() + days);
    return result;
  }
}
