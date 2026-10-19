import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ProblemDetailsFilter } from './common/problem-details/problem-details.filter.js';
import { validationProblem } from './common/problem-details/validation-problem.js';
import { setupApiDocs } from './docs/openapi.js';

/**
 * Global HTTP setup shared by main.ts and the e2e tests, so tests exercise
 * exactly the pipe, filter and routing the real app uses.
 */
/**
 * Express parses JSON bodies up to 100 KB by default. A valid 20,000-character
 * lesson can exceed that once encoded as UTF-8 JSON, which would be rejected
 * by the body parser before our own 413 check runs, so allow a little more.
 */
export const JSON_BODY_LIMIT = '256kb';

export interface ConfigureAppOptions {
  /** Serve Swagger UI at /docs and the spec at /docs-json (API_DOCS_ENABLED). */
  apiDocs?: boolean;
}

export function configureApp(
  app: NestExpressApplication,
  { apiDocs = false }: ConfigureAppOptions = {},
): void {
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  // Feature routes live under /api; /health and /docs stay at the root.
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationProblem,
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());
  // After the global prefix, so the documented paths include /api.
  if (apiDocs) {
    setupApiDocs(app);
  }
}
