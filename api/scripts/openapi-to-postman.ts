/**
 * Converts postman/openapi.json into
 * postman/QuizForge.generated.postman_collection.json with Postman's own
 * converter. Run through `npm run openapi:export`, after the spec export.
 *
 * Two things would otherwise change the file on every run, so the output
 * only changes when the API does:
 * - the converter gives every item a random id; those ids are removed
 *   (Postman does not need them);
 * - where a field has no usable example (a null example counts as none), it
 *   makes one up with Math.random; this one-off process seeds Math.random.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CollectionResult } from 'openapi-to-postmanv2';

/** mulberry32: a tiny seeded generator, so made-up example values are the same on every run. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// Before the converter loads: its schema faker keeps a reference to Math.random.
Math.random = seededRandom(1);
const { convertV2 } = await import('openapi-to-postmanv2');

const POSTMAN_DIR = join(import.meta.dirname, '..', '..', 'postman');
const SPEC = join(POSTMAN_DIR, 'openapi.json');
const COLLECTION = join(
  POSTMAN_DIR,
  'QuizForge.generated.postman_collection.json',
);

/** Random per-run identifiers the converter adds; not part of the collection's meaning. */
const RANDOM_ID_KEYS = new Set(['id', '_postman_id']);

function withoutRandomIds(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutRandomIds);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !RANDOM_ID_KEYS.has(key))
        .map(([key, child]) => [key, withoutRandomIds(child)]),
    );
  }
  return value;
}

function convert(spec: object): Promise<object> {
  return new Promise((resolve, reject) => {
    convertV2(
      { type: 'json', data: spec },
      {
        folderStrategy: 'Tags',
        requestNameSource: 'Fallback',
        // Use the examples from the DTO decorators instead of random fake values.
        parametersResolution: 'Example',
      },
      (error, result?: CollectionResult) => {
        const output = result?.output?.[0]?.data;
        if (error || !result?.result || !output) {
          reject(
            new Error(
              `OpenAPI to Postman conversion failed: ${error?.message ?? result?.reason ?? 'no output'}`,
            ),
          );
          return;
        }
        resolve(output);
      },
    );
  });
}

const spec = JSON.parse(readFileSync(SPEC, 'utf8')) as object;
const collection = withoutRandomIds(await convert(spec));
writeFileSync(COLLECTION, `${JSON.stringify(collection, null, 2)}\n`);
console.log(`Wrote ${COLLECTION}`);
