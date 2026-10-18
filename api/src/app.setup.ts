import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ProblemDetailsFilter } from './common/problem-details/problem-details.filter.js';
import { validationProblem } from './common/problem-details/validation-problem.js';

/**
 * Global HTTP setup shared by main.ts and the e2e tests, so tests exercise
 * exactly the pipe, filter and routing the real app uses.
 */
export function configureApp(app: INestApplication): void {
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
