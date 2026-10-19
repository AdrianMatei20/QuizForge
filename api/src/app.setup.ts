import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ProblemDetailsFilter } from './common/problem-details/problem-details.filter.js';
import { validationProblem } from './common/problem-details/validation-problem.js';

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

export function configureApp(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  // Feature routes live under /api; /health stays at the root for infrastructure probes.
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
}
