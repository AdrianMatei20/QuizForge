import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';

export const API_DOCS_PATH = 'docs';

/**
 * The OpenAPI document, built from the controllers' and DTOs' decorators.
 * Used by the running app (/docs) and by scripts/export-openapi.ts, which
 * writes it to postman/openapi.json.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('QuizForge API')
    .setDescription(
      'Turns a lesson into a reviewed quiz: an LLM drafts the questions, a ' +
        'teacher edits, approves, rejects or regenerates them, then publishes ' +
        'the quiz.\n\n' +
        'Every error is an RFC 9457 problem details response ' +
        '(`application/problem+json`).',
    )
    .setVersion('0.0.1')
    // Paths include the /api prefix, so this is the bare origin. Postman's
    // converter turns it into a {{baseUrl}} variable.
    .addServer('http://localhost:3000', 'Local development')
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Swagger UI at /docs and the raw spec at /docs-json. */
export function setupApiDocs(app: INestApplication): void {
  SwaggerModule.setup(API_DOCS_PATH, app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: `${API_DOCS_PATH}-json`,
  });
}
