import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

describe('API docs (e2e)', () => {
  async function createApp(apiDocs: boolean) {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    configureApp(app, { apiDocs });
    await app.init();
    return app;
  }

  describe('enabled', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await createApp(true);
    });

    afterAll(async () => {
      await app.close();
    });

    it('serves Swagger UI at /docs', async () => {
      const response = await request(app.getHttpServer())
        .get('/docs')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/text\/html/);
      expect(response.text).toContain('swagger');
    });

    it('serves the OpenAPI document at /docs-json, with /api paths', async () => {
      const response = await request(app.getHttpServer())
        .get('/docs-json')
        .expect(200);

      const body = response.body as {
        openapi: string;
        paths: Record<string, unknown>;
      };
      expect(body.openapi).toMatch(/^3\./);
      expect(body.paths).toHaveProperty('/api/lessons');
      expect(body.paths).toHaveProperty('/health');
    });
  });

  describe('disabled', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await createApp(false);
    });

    afterAll(async () => {
      await app.close();
    });

    it('serves neither /docs nor /docs-json', async () => {
      await request(app.getHttpServer()).get('/docs').expect(404);
      await request(app.getHttpServer()).get('/docs-json').expect(404);
    });
  });
});
