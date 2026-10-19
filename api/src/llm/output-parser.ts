import type { z } from 'zod';
import type { LlmViolation } from './llm.errors.js';

export type ParseOutcome<T> =
  | {
      ok: true;
      data: T;
      /** The JSON value before zod ran (and before any zod transforms). */
      json: unknown;
    }
  | { ok: false; violations: LlmViolation[] };

const CODE_FENCE = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?\s*```$/;

/** Models sometimes wrap JSON in a ```json ... ``` block despite instructions. */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  return CODE_FENCE.exec(trimmed)?.[1]?.trim() ?? trimmed;
}

/**
 * Turns raw model text into typed data: strip code fences, JSON.parse, then
 * validate with the zod schema. Violations describe what is wrong without
 * quoting the output, because they can end up in client responses.
 */
export function parseModelOutput<T>(
  text: string,
  schema: z.ZodType<T>,
): ParseOutcome<T> {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFences(text));
  } catch {
    // JSON.parse messages quote the input, so use our own.
    return {
      ok: false,
      violations: [{ message: 'The response is not valid JSON.' }],
    };
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    return {
      ok: false,
      violations: result.error.issues.map((issue) => ({
        pointer: toJsonPointer(issue.path),
        // zod's message for unknown keys quotes the key names, which come from
        // the model's output, so it is replaced with one that does not.
        message:
          issue.code === 'unrecognized_keys'
            ? 'Contains properties that are not allowed.'
            : issue.message,
      })),
    };
  }
  return { ok: true, data: result.data, json };
}

/** RFC 6901 pointer such as "#/questions/0/text" ("#" is the whole document). */
function toJsonPointer(path: readonly PropertyKey[]): string {
  const segments = path.map((segment) =>
    String(segment).replaceAll('~', '~0').replaceAll('/', '~1'),
  );
  return ['#', ...segments].join('/');
}
