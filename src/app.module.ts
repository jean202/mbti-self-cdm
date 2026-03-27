import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppFeatureModule } from './modules/app/app.module';
import { AuthModule } from './modules/auth/auth.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { HealthModule } from './modules/health/health.module';
import { HomeModule } from './modules/home/home.module';
import { IdeasModule } from './modules/ideas/ideas.module';
import { MbtiModule } from './modules/mbti/mbti.module';
import { MeModule } from './modules/me/me.module';
import { PlanModule } from './modules/plan/plan.module';
import { ReflectModule } from './modules/reflect/reflect.module';
import { SessionModule } from './modules/session/session.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TypeProfilesModule } from './modules/type-profiles/type-profiles.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { QueueModule } from './infra/queue/queue.module';
import { RedisModule } from './infra/redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      expandVariables: true,
    }),
    PrismaModule,
    RedisModule,
    QueueModule,
    HealthModule,
    AppFeatureModule,
    AuthModule,
    SessionModule,
    UsersModule,
    MbtiModule,
    TypeProfilesModule,
    HomeModule,
    PlanModule,
    TasksModule,
    IdeasModule,
    ReflectModule,
    CalendarModule,
    MeModule,
  ],
})
export class AppModule {}
