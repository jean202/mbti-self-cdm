import { Injectable, Logger } from '@nestjs/common';
import { Prisma, RoutineCadenceType, TaskSourceType } from '@prisma/client';

import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreateRoutineDto } from './dto/create-routine.dto';

@Injectable()
export class RoutinesService {
  private readonly logger = new Logger(RoutinesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createRoutine(userId: string, dto: CreateRoutineDto) {
    this.logger.log(`Creating routine for user: ${userId}`);
    return this.prisma.routine.create({
      data: {
        userId,
        name: dto.title,
        note: dto.note,
        cadenceType: RoutineCadenceType.WEEKLY,
        isActive: dto.isActive ?? true,
        cadencePayloadJson: { daysOfWeek: dto.daysOfWeek } as Prisma.InputJsonValue,
      },
    });
  }

  async getRoutines(userId: string) {
    return this.prisma.routine.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async generateTodayTasks(userId: string) {
    this.logger.log(`Checking routines to generate today's tasks for user: ${userId}`);
    
    const today = new Date();
    const todayDow = today.getDay(); // 0(Sun) ~ 6(Sat)

    // 활성화된 사용자 루틴을 모두 가져옵니다
    const routines = await this.prisma.routine.findMany({
      where: {
        userId,
        isActive: true,
      },
    });

    let generatedCount = 0;

    for (const routine of routines) {
      const rule = routine.cadencePayloadJson as { daysOfWeek?: number[] };
      
      // 오늘 요일에 실행하는 루틴인지 확인
      if (!rule || !Array.isArray(rule.daysOfWeek) || !rule.daysOfWeek.includes(todayDow)) {
        continue;
      }

      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      // 오늘 이미 이 루틴으로 Task가 생성되었는지 확인 (중복 생성 방지)
      const existingTask = await this.prisma.task.findFirst({
        where: {
          userId,
          title: routine.name,
          sourceType: TaskSourceType.ROUTINE,
          createdAt: { gte: startOfDay, lte: endOfDay },
        },
      });

      if (!existingTask) {
        await this.prisma.task.create({
          data: {
            userId,
            title: routine.name,
            note: routine.note,
            sourceType: TaskSourceType.ROUTINE,
          },
        });
        generatedCount++;
      }
    }

    return { generated_count: generatedCount };
  }
}