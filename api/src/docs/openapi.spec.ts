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
      '/api/lessons',
      '/api/lessons/{id}',
      '/api/lessons/{lessonId}/quizzes',
      '/api/questions/{id}',
      '/api/questions/{id}/regenerate',
      '/api/quizzes/{id}',
      '/api/quizzes/{id}/cost',
      '/api/quizzes/{id}/publish',
      '/api/quizzes/{id}/review-stats',
      '/api/quizzes/{id}/stream',
      '/health',
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
});
