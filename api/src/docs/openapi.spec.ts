import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateOpenApiDocument } from './generate-openapi.js';

const COMMITTED_SPEC = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'postman',
  'openapi.json',
);

/**
 * Keeps postman/openapi.json (and the Postman collection generated from it)
 * in step with the code: any change to an endpoint, DTO or documented error
 * fails this test until the export is run again.
 */
describe('OpenAPI document', () => {
  it('matches the committed postman/openapi.json (run `npm run openapi:export` if not)', async () => {
    const generated = await generateOpenApiDocument();
    const committed = JSON.parse(
      readFileSync(COMMITTED_SPEC, 'utf8'),
    ) as unknown;

    // Compared as JSON, exactly as the export writes it.
    expect(JSON.parse(JSON.stringify(generated))).toEqual(committed);
  });

  it('documents every endpoint, with problem details for its errors', async () => {
    const { paths } = await generateOpenApiDocument();

    expect(Object.keys(paths).sort()).toEqual([
      '/api/evals',
      '/api/evals/compare',
      '/api/info',
      '/api/lessons',
      '/api/lessons/{id}',
      '/api/lessons/{lessonId}/quizzes',
      '/api/public/quizzes/{id}',
      '/api/public/quizzes/{id}/attempts',
      '/api/questions/{id}',
      '/api/questions/{id}/regenerate',
      '/api/quizzes/{id}',
      '/api/quizzes/{id}/attempt-stats',
      '/api/quizzes/{id}/cost',
      '/api/quizzes/{id}/publish',
      '/api/quizzes/{id}/review-stats',
      '/api/quizzes/{id}/stream',
      '/api/usage',
      '/health',
      '/metrics',
    ]);
    for (const [path, operations] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const responses = (operation as { responses: Record<string, object> })
          .responses;
        const errors = Object.entries(responses).filter(
          ([status]) => Number(status) >= 400,
        );
        expect(
          errors.length,
          `${method} ${path} documents no errors`,
        ).toBeGreaterThan(0);
        for (const [status, response] of errors) {
          expect(
            response,
            `${method} ${path} ${status} is not problem details`,
          ).toHaveProperty(['content', 'application/problem+json']);
        }
      }
    }
  });

  /**
   * Swagger completeness: every operation says what it does and documents
   * its success response; every schema property has a type and is
   * explained (a description or an example).
   */
  it('describes every operation, its success response and every schema property', async () => {
    const document = await generateOpenApiDocument();
    const problems: string[] = [];

    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(item ?? {})) {
        const op = operation as {
          summary?: string;
          description?: string;
          responses: Record<string, { content?: Record<string, unknown> }>;
        };
        const where = `${method.toUpperCase()} ${path}`;
        if (!op.summary) problems.push(`${where}: no summary`);
        if (!op.description) problems.push(`${where}: no description`);
        const success = Object.entries(op.responses).filter(([status]) =>
          status.startsWith('2'),
        );
        if (success.length === 0)
          problems.push(`${where}: no success response`);
        for (const [status, response] of success) {
          if (!response.content) {
            problems.push(`${where}: ${status} response has no content type`);
          }
        }
      }
    }

    const schemas = (document.components?.schemas ?? {}) as Record<
      string,
      { properties?: Record<string, Record<string, unknown>> }
    >;
    for (const [name, schema] of Object.entries(schemas)) {
      for (const [property, definition] of Object.entries(
        schema.properties ?? {},
      )) {
        const typed =
          'type' in definition ||
          '$ref' in definition ||
          'allOf' in definition ||
          'oneOf' in definition ||
          'enum' in definition;
        if (!typed) problems.push(`${name}.${property}: no type`);
        // A $ref points at a schema that explains itself.
        const explained =
          'description' in definition ||
          'example' in definition ||
          '$ref' in definition ||
          'allOf' in definition;
        if (!explained) {
          problems.push(`${name}.${property}: no description or example`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
