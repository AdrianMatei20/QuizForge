import { z } from 'zod';

// Money stays a decimal string so it never passes through a float.
const USD_AMOUNT = /^\d+(\.\d{1,2})?$/;

// An empty value in a .env file (`LLM_API_KEY=`) means "not set".
const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);

export const baseEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Swagger UI at /docs and the spec at /docs-json. "true"/"false" (also 1/0, yes/no).
  API_DOCS_ENABLED: z.stringbool().default(true),
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: 'must be a postgres:// URL',
  }),
  REDIS_URL: z.url({
    protocol: /^rediss?$/,
    error: 'must be a redis:// or rediss:// URL',
  }),
  LLM_PROVIDER: z.enum(['anthropic', 'fake']),
  LLM_API_KEY: optionalSecret,
  LLM_MODEL: z.string().min(1),
  LLM_JUDGE_MODEL: z.string().min(1),
  LLM_DAILY_BUDGET_USD: z
    .string()
    .regex(USD_AMOUNT, 'must be a decimal USD amount such as "5.00"'),
  LLM_CACHE_TTL_SECONDS: z.coerce.number().int().min(0),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1).default(60_000),
  // The longest a provider's Retry-After header can make a retry wait.
  LLM_RETRY_AFTER_MAX_MS: z.coerce.number().int().min(0).default(10_000),
  // Full-jitter backoff between retries: up to base * 2^(attempt - 1), capped at max.
  LLM_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).default(500),
  LLM_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(0).default(8_000),
  // Relative paths resolve against the working directory (api/ for npm scripts).
  LLM_PRICING_FILE: z.string().min(1).default('config/llm-pricing.json'),
  // A generated question's sourceQuote must have at least this many words.
  QUIZ_SOURCE_QUOTE_MIN_WORDS: z.coerce.number().int().min(1).default(5),
  // A streamed quiz's whole generation, repair included. The provider stream is aborted after this.
  QUIZ_GENERATION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .default(180_000),
  // How often quizzes left "generating" by a crash or restart are cleaned up (also once at startup).
  QUIZ_STUCK_SWEEP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .default(300_000),
});

export const envSchema = baseEnvSchema.refine(
  (env) => env.LLM_PROVIDER === 'fake' || env.LLM_API_KEY !== undefined,
  {
    path: ['LLM_API_KEY'],
    message: 'is required unless LLM_PROVIDER is "fake"',
    // Run even when unrelated variables are invalid, so every problem is reported at once.
    when: (payload) =>
      !payload.issues.some(
        (issue) =>
          issue.path?.[0] === 'LLM_PROVIDER' ||
          issue.path?.[0] === 'LLM_API_KEY',
      ),
  },
);

export type Env = z.infer<typeof envSchema>;

/**
 * Parses raw environment variables with the given schema. On failure it throws
 * one error listing every invalid variable by name. Values are never included,
 * because they may be secrets.
 */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  raw: Record<string, unknown>,
): z.infer<T> {
  const result = schema.safeParse(raw, {
    error: (issue) =>
      issue.code === 'invalid_type' && issue.input === undefined
        ? 'is required'
        : undefined,
  });
  if (result.success) {
    return result.data;
  }
  const lines = result.error.issues.map(
    (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
  );
  throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
}

/** Used by ConfigModule.forRoot({ validate }). */
export function validateEnv(raw: Record<string, unknown>): Env {
  return parseEnv(envSchema, raw);
}
