/**
 * OpenAPI 스펙 내보내기 스크립트
 *
 * 사용법: npm run export:openapi
 * 결과: docs/openapi.json
 *
 * Flutter API 클라이언트 생성 시 이 파일을 입력으로 사용:
 *   npx @openapitools/openapi-generator-cli generate \
 *     -i docs/openapi.json \
 *     -g dart-dio \
 *     -o client/lib/api
 */

const { NestFactory } = require('@nestjs/core');
const { FastifyAdapter } = require('@nestjs/platform-fastify');
const { DocumentBuilder, SwaggerModule } = require('@nestjs/swagger');
const { AppModule } = require('../dist/app.module');
const fs = require('fs');
const path = require('path');

async function exportSpec() {
  const app = await NestFactory.create(
    AppModule,
    new FastifyAdapter(),
    { logger: false },
  );

  app.setGlobalPrefix('v1');

  const config = new DocumentBuilder()
    .setTitle('MBTI Self-CDM API')
    .setDescription('MBTI 기반 자기관리 앱 백엔드 API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addServer('http://localhost:3000', 'Local Development')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const outputPath = path.resolve(__dirname, '../docs/openapi.json');

  fs.writeFileSync(outputPath, JSON.stringify(document, null, 2));

  const pathCount = Object.keys(document.paths).length;
  const endpointCount = Object.values(document.paths).reduce(
    (sum, methods) => sum + Object.keys(methods).length,
    0,
  );

  console.log(`Exported: ${outputPath}`);
  console.log(`Paths: ${pathCount}, Endpoints: ${endpointCount}`);

  await app.close();
}

exportSpec().catch((err) => {
  console.error('Failed to export OpenAPI spec:', err);
  process.exit(1);
});
