import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/infra/prisma/prisma.service';

export type E2eApp = {
  app: NestFastifyApplication;
  prisma: PrismaService;
  close: () => Promise<void>;
};

export type LoggedInUser = {
  userId: string;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  deviceId: string;
  providerUserId: string;
};

// 테스트가 만든 사용자는 close()에서 지운다. 연관 데이터는 onDelete: Cascade로 같이 지워진다.
const trackedUsers = new WeakMap<NestFastifyApplication, Set<string>>();

// 실제 AppModule을 main.ts와 같은 전역 설정으로 띄운다. 인증 가드는 우회하지 않는다.
// env는 이 앱 인스턴스에서만 ConfigService 값을 덮어쓴다(.env나 process.env보다 우선).
export async function createE2eApp(
  options: { env?: Record<string, string> } = {},
): Promise<E2eApp> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  if (options.env) {
    overrideConfig(moduleFixture.get(ConfigService), options.env);
  }

  const app = moduleFixture.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const prisma = app.get(PrismaService);
  const createdUserIds = new Set<string>();
  trackedUsers.set(app, createdUserIds);

  return {
    app,
    prisma,
    close: async () => {
      if (createdUserIds.size > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: [...createdUserIds] } },
        });
      }
      await app.close();
    },
  };
}

function overrideConfig(
  configService: ConfigService,
  overrides: Record<string, string>,
): void {
  const originalGet = configService.get.bind(configService);

  configService.get = ((key: string, ...rest: unknown[]) =>
    Object.prototype.hasOwnProperty.call(overrides, key)
      ? overrides[key]
      : (originalGet as (...args: unknown[]) => unknown)(
          key,
          ...rest,
        )) as ConfigService['get'];
}

// dev identity bridge로 매번 새 사용자를 만든다. 테스트끼리 데이터가 섞이지 않는다.
export async function loginNewUser(
  app: NestFastifyApplication,
  options: { providerUserId?: string; deviceId?: string } = {},
): Promise<LoggedInUser> {
  const providerUserId = options.providerUserId ?? `e2e-${randomUUID()}`;
  const deviceId = options.deviceId ?? `device-${randomUUID()}`;
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/social/login',
    payload: {
      provider: 'GOOGLE',
      provider_payload: { provider_user_id: providerUserId },
      device: { device_id: deviceId, platform: 'IOS', app_version: '1.0.0' },
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(
      `social login failed: ${response.statusCode} ${response.payload}`,
    );
  }

  const { data } = response.json();
  trackedUsers.get(app)?.add(data.user.id);

  return {
    userId: data.user.id,
    accessToken: data.tokens.access_token,
    refreshToken: data.tokens.refresh_token,
    sessionId: data.tokens.session_id,
    deviceId,
    providerUserId,
  };
}

// MBTI 확정과 캘린더 건너뛰기까지 마쳐 온보딩이 COMPLETED인 사용자를 만든다.
export async function loginOnboardedUser(
  app: NestFastifyApplication,
  typeCode = 'INFP',
): Promise<LoggedInUser> {
  const user = await loginNewUser(app);

  await expectStatus(
    authed(app, user, {
      method: 'POST',
      url: '/v1/mbti/profile/confirm',
      payload: { type_code: typeCode, source: 'SELF_SELECTED' },
    }),
    201,
  );
  await expectStatus(
    authed(app, user, { method: 'POST', url: '/v1/onboarding/calendar/skip' }),
    201,
  );

  return user;
}

export function authed(
  app: NestFastifyApplication,
  user: Pick<LoggedInUser, 'accessToken'>,
  options: InjectOptions,
): Promise<LightMyRequestResponse> {
  return app.inject({
    ...options,
    headers: {
      ...(options.headers ?? {}),
      authorization: `Bearer ${user.accessToken}`,
    },
  });
}

export async function expectStatus(
  pending: Promise<LightMyRequestResponse>,
  status: number,
): Promise<LightMyRequestResponse> {
  const response = await pending;

  if (response.statusCode !== status) {
    throw new Error(
      `expected HTTP ${status} but got ${response.statusCode}: ${response.payload}`,
    );
  }

  return response;
}
