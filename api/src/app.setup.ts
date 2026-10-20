import type { NestExpressApplication } from '@nestjs/platform-express';
import { ProblemDetailsFilter } from './common/problem-details/problem-details.filter.js';
import { ProblemValidationPipe } from './common/problem-details/validation-problem.js';
import { TracingInterceptor } from './common/tracing/tracing.interceptor.js';
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
  /**
   * TRUST_PROXY_HOPS. Behind a proxy every request comes from the proxy's
   * address, so all clients would share one rate limit; trusting that many
   * hops makes req.ip the client's address from X-Forwarded-For. Only the
   * given number of hops is trusted, so a client cannot spoof its address
   * by sending the header itself.
   */
  trustProxyHops?: number;
}

export function configureApp(
  app: NestExpressApplication,
  { apiDocs = false, trustProxyHops = 0 }: ConfigureAppOptions = {},
): void {
  if (trustProxyHops > 0) {
    app.set('trust proxy', trustProxyHops);
  }
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  // Feature routes live under /api; /health and /docs stay at the root.
  app.setGlobalPrefix('api', { exclude: ['health', 'metrics'] });
  app.useGlobalPipes(
    new ProblemValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());
  // A span per handler when tracing is on; a no-op otherwise.
  app.useGlobalInterceptors(new TracingInterceptor());
  // After the global prefix, so the documented paths include /api.
  if (apiDocs) {
    setupApiDocs(app);
  }
}
