import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from '../app.module.js';
import { configureApp } from '../app.setup.js';
import { buildOpenApiDocument } from './openapi.js';

/**
 * The OpenAPI document without a running app. Preview mode reads the module
 * graph and controller metadata but creates no providers, so nothing
 * connects to PostgreSQL, Redis or the LLM provider. Config is still
 * validated when AppModule is imported, so NODE_ENV must already be set
 * (the export script uses "test", which reads the committed .env.test).
 */
export async function generateOpenApiDocument(): Promise<OpenAPIObject> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    preview: true,
    logger: false,
  });
  try {
    // Same prefix and routing as the real app.
    configureApp(app);
    return buildOpenApiDocument(app);
  } finally {
    await app.close();
  }
}
