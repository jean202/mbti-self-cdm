import { Test, type TestingModule } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { OnboardingStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { AuthGuard } from '../src/common/auth/auth.guard';

describe('App Integration & DB (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  
  // E2E 테스트 전용 임시 유저 ID
  const testUserId = 'test-e2e-user-id';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // 인증 가드(AuthGuard)를 모킹하여 로그인된 상태로 통과시킴
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = {
            userId: testUserId,
            provider: 'KAKAO',
            providerId: 'kakao-e2e',
            roles: ['USER'],
            sessionId: 'session-e2e',
          };
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready(); // Fastify 인스턴스 준비

    prisma = app.get(PrismaService);

    // 테스트용 유저를 DB에 생성 (이미 있으면 무시)
    await prisma.user.upsert({
      where: { id: testUserId },
      update: {},
      create: {
        id: testUserId,
        onboardingStatus: OnboardingStatus.COMPLETED,
      },
    });
  });

  afterAll(async () => {
    // 테스트 종료 시 생성한 테스트 데이터 정리
    await prisma.calendarConnection.deleteMany({ where: { userId: testUserId } });
    await prisma.user.delete({ where: { id: testUserId } });

    await prisma.$disconnect();
    await app.close();
  });

  it('should connect to the real database successfully', async () => {
    const result = await prisma.$queryRaw`SELECT 1 as result`;
    expect(result).toBeDefined();
    expect((result as any)[0].result).toBe(1);
  });

  describe('Calendar API E2E', () => {
    it('GET /v1/calendar/connections - should return empty array for new user', async () => {
      // Fastify의 inject를 사용해 포트를 열지 않고 HTTP 요청을 모방
      const response = await app.inject({
        method: 'GET',
        url: '/v1/calendar/connections',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      
      // DB에서 실제로 조회해 온 빈 배열인지 검증
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(0);
    });
    
    // 향후 Tasks, Home 모듈에 대한 E2E 테스트도 이 블록 아래에 추가할 수 있습니다.
  });
});