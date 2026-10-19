/**
 * Writes the OpenAPI document to postman/openapi.json at the repo root.
 * Run through `npm run openapi:export`, which builds first: the spec comes
 * from the compiled code (Nest needs the decorator metadata that tsc emits).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Before AppModule is imported: config is validated at import time, and the
// committed .env.test makes the export independent of a local .env.
process.env['NODE_ENV'] = 'test';
const { generateOpenApiDocument } = await import('./generate-openapi.js');

// dist/docs/export-openapi.js -> <repo>/postman
const POSTMAN_DIR = join(import.meta.dirname, '..', '..', '..', 'postman');

const document = await generateOpenApiDocument();
mkdirSync(POSTMAN_DIR, { recursive: true });
const target = join(POSTMAN_DIR, 'openapi.json');
writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
console.log(`Wrote ${target} (${Object.keys(document.paths).length} paths)`);
