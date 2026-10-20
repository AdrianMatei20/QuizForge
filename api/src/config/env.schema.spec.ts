import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv as parseEnvFile } from 'node:util';
import { validateEnv } from './env.schema.js';

const validEnv = {
  NODE_ENV: 'development',
  PORT: '3000',
  DATABASE_URL: 'postgres://quizforge:quizforge@localhost:5432/quizforge',
  REDIS_URL: 'redis://localhost:6379',
  LLM_PROVIDER: 'fake',
  LLM_MODEL: 'fake-model',
  LLM_JUDGE_MODEL: 'fake-judge-model',
  LLM_DAILY_BUDGET_USD: '5.00',
  LLM_CACHE_TTL_SECONDS: '86400',
};

function errorMessageFor(raw: Record<string, unknown>): string {
  try {
    validateEnv(raw);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected validateEnv to throw');
}

describe('validateEnv', () => {
  it('accepts a valid fake-provider config without an API key', () => {
    const env = validateEnv(validEnv);

    expect(env.LLM_PROVIDER).toBe('fake');
    expect(env.LLM_API_KEY).toBeUndefined();
  });

  it('coerces numeric variables and keeps the budget as a decimal string', () => {
    const env = validateEnv(validEnv);

    expect(env.PORT).toBe(3000);
    expect(env.LLM_CACHE_TTL_SECONDS).toBe(86400);
    expect(env.LLM_DAILY_BUDGET_USD).toBe('5.00');
  });

  it('applies defaults for NODE_ENV and PORT', () => {
    const { NODE_ENV: _nodeEnv, PORT: _port, ...rest } = validEnv;

    const env = validateEnv(rest);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
  });

  it('applies defaults for the LLM timeout and pricing file', () => {
    const env = validateEnv(validEnv);

    expect(env.LLM_TIMEOUT_MS).toBe(60_000);
    expect(env.LLM_PRICING_FILE).toBe('config/llm-pricing.json');
  });

  it('defaults the Retry-After cap to 10 s and accepts 0', () => {
    expect(validateEnv(validEnv).LLM_RETRY_AFTER_MAX_MS).toBe(10_000);
    expect(
      validateEnv({ ...validEnv, LLM_RETRY_AFTER_MAX_MS: '0' })
        .LLM_RETRY_AFTER_MAX_MS,
    ).toBe(0);
    expect(
      errorMessageFor({ ...validEnv, LLM_RETRY_AFTER_MAX_MS: '-1' }),
    ).toContain('LLM_RETRY_AFTER_MAX_MS');
  });

  it('defaults the sourceQuote minimum to 5 words and rejects 0', () => {
    expect(validateEnv(validEnv).QUIZ_SOURCE_QUOTE_MIN_WORDS).toBe(5);
    expect(
      validateEnv({ ...validEnv, QUIZ_SOURCE_QUOTE_MIN_WORDS: '8' })
        .QUIZ_SOURCE_QUOTE_MIN_WORDS,
    ).toBe(8);
    expect(
      errorMessageFor({ ...validEnv, QUIZ_SOURCE_QUOTE_MIN_WORDS: '0' }),
    ).toContain('QUIZ_SOURCE_QUOTE_MIN_WORDS');
  });

  it('defaults the retry backoff to 500 ms base and 8 s max', () => {
    const env = validateEnv(validEnv);

    expect(env.LLM_RETRY_BASE_DELAY_MS).toBe(500);
    expect(env.LLM_RETRY_MAX_DELAY_MS).toBe(8_000);
    expect(
      errorMessageFor({ ...validEnv, LLM_RETRY_BASE_DELAY_MS: '-5' }),
    ).toContain('LLM_RETRY_BASE_DELAY_MS');
  });

  it('enables the API docs by default and parses true/false strings', () => {
    expect(validateEnv(validEnv).API_DOCS_ENABLED).toBe(true);
    expect(
      validateEnv({ ...validEnv, API_DOCS_ENABLED: 'false' }).API_DOCS_ENABLED,
    ).toBe(false);
    expect(
      errorMessageFor({ ...validEnv, API_DOCS_ENABLED: 'maybe' }),
    ).toContain('API_DOCS_ENABLED');
  });

  it('defaults the quiz generation timeout to 3 minutes and the stuck-quiz sweep to 5', () => {
    const env = validateEnv(validEnv);

    expect(env.QUIZ_GENERATION_TIMEOUT_MS).toBe(180_000);
    expect(env.QUIZ_STUCK_SWEEP_INTERVAL_MS).toBe(300_000);
    expect(
      errorMessageFor({ ...validEnv, QUIZ_GENERATION_TIMEOUT_MS: '10' }),
    ).toContain('QUIZ_GENERATION_TIMEOUT_MS');
  });

  it('defaults the generate throttle to 10 per minute and leaves tracing off', () => {
    const env = validateEnv(validEnv);

    expect(env.THROTTLE_GENERATE_LIMIT).toBe(10);
    expect(env.THROTTLE_GENERATE_TTL_MS).toBe(60_000);
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(
      validateEnv({ ...validEnv, OTEL_EXPORTER_OTLP_ENDPOINT: '' })
        .OTEL_EXPORTER_OTLP_ENDPOINT,
    ).toBeUndefined();
    expect(
      errorMessageFor({
        ...validEnv,
        OTEL_EXPORTER_OTLP_ENDPOINT: 'localhost:4318',
      }),
    ).toContain('OTEL_EXPORTER_OTLP_ENDPOINT');
  });

  it('defaults the attempt throttle and the attempt-stat thresholds', () => {
    const env = validateEnv(validEnv);

    expect(env.THROTTLE_ATTEMPT_LIMIT).toBe(20);
    expect(env.THROTTLE_ATTEMPT_TTL_MS).toBe(60_000);
    expect(env.ATTEMPT_FLAG_TOO_EASY_ABOVE).toBe(0.9);
    expect(env.ATTEMPT_FLAG_POSSIBLY_WRONG_BELOW).toBe(0.2);
    expect(env.ATTEMPT_FLAG_MIN_ATTEMPTS).toBe(5);
  });

  it('rejects thresholds outside 0 to 1, or a lower threshold not below the upper one', () => {
    expect(
      errorMessageFor({ ...validEnv, ATTEMPT_FLAG_TOO_EASY_ABOVE: '1.5' }),
    ).toContain('ATTEMPT_FLAG_TOO_EASY_ABOVE');
    expect(
      errorMessageFor({
        ...validEnv,
        ATTEMPT_FLAG_TOO_EASY_ABOVE: '0.5',
        ATTEMPT_FLAG_POSSIBLY_WRONG_BELOW: '0.5',
      }),
    ).toContain(
      'ATTEMPT_FLAG_POSSIBLY_WRONG_BELOW: must be below ATTEMPT_FLAG_TOO_EASY_ABOVE',
    );
  });

  it('defaults to demo mode restrictions on and no trusted proxy', () => {
    const env = validateEnv(validEnv);

    expect(env.FAKE_LLM_SAMPLE_LESSONS_ONLY).toBe(true);
    expect(env.TRUST_PROXY_HOPS).toBe(0);
    expect(
      validateEnv({ ...validEnv, FAKE_LLM_SAMPLE_LESSONS_ONLY: 'false' })
        .FAKE_LLM_SAMPLE_LESSONS_ONLY,
    ).toBe(false);
    expect(errorMessageFor({ ...validEnv, TRUST_PROXY_HOPS: '-1' })).toContain(
      'TRUST_PROXY_HOPS',
    );
  });

  it('accepts .env.example as it is, so `cp .env.example .env` gives a working config', () => {
    const example = parseEnvFile(
      readFileSync(
        join(import.meta.dirname, '..', '..', '.env.example'),
        'utf8',
      ),
    );

    expect(() => validateEnv(example)).not.toThrow();
    expect(validateEnv(example).LLM_PROVIDER).toBe('fake');
  });

  it('rejects a timeout that is not a positive integer', () => {
    expect(errorMessageFor({ ...validEnv, LLM_TIMEOUT_MS: '0' })).toContain(
      'LLM_TIMEOUT_MS',
    );
  });

  it('accepts the anthropic provider when an API key is set', () => {
    const env = validateEnv({
      ...validEnv,
      LLM_PROVIDER: 'anthropic',
      LLM_API_KEY: 'sk-test',
    });

    expect(env.LLM_API_KEY).toBe('sk-test');
  });

  it('rejects the anthropic provider without an API key', () => {
    const message = errorMessageFor({ ...validEnv, LLM_PROVIDER: 'anthropic' });

    expect(message).toContain(
      'LLM_API_KEY: is required unless LLM_PROVIDER is "fake"',
    );
  });

  it('treats an empty API key as missing', () => {
    const message = errorMessageFor({
      ...validEnv,
      LLM_PROVIDER: 'anthropic',
      LLM_API_KEY: '',
    });

    expect(message).toContain('LLM_API_KEY');
  });

  it('rejects an unknown provider', () => {
    const message = errorMessageFor({ ...validEnv, LLM_PROVIDER: 'openai' });

    expect(message).toContain('LLM_PROVIDER');
  });

  it('accepts a daily budget of 0, which blocks every LLM call', () => {
    expect(
      validateEnv({ ...validEnv, LLM_DAILY_BUDGET_USD: '0' })
        .LLM_DAILY_BUDGET_USD,
    ).toBe('0');
  });

  it('rejects a budget that is not a decimal amount', () => {
    for (const budget of ['five', '-1', '1.234', '1e3']) {
      const message = errorMessageFor({
        ...validEnv,
        LLM_DAILY_BUDGET_USD: budget,
      });

      expect(message).toContain('LLM_DAILY_BUDGET_USD');
    }
  });

  it('rejects URLs with the wrong scheme', () => {
    const message = errorMessageFor({
      ...validEnv,
      DATABASE_URL: 'mysql://localhost/quizforge',
      REDIS_URL: 'http://localhost:6379',
    });

    expect(message).toContain('DATABASE_URL: must be a postgres:// URL');
    expect(message).toContain('REDIS_URL');
  });

  it('reports a missing variable as required', () => {
    const { LLM_MODEL: _model, ...rest } = validEnv;

    expect(errorMessageFor(rest)).toContain('LLM_MODEL: is required');
  });

  it('reports every invalid variable at once, including the API key rule', () => {
    const message = errorMessageFor({
      ...validEnv,
      PORT: 'not-a-port',
      LLM_PROVIDER: 'anthropic',
      LLM_CACHE_TTL_SECONDS: '-5',
    });

    expect(message).toContain('PORT');
    expect(message).toContain('LLM_CACHE_TTL_SECONDS');
    expect(message).toContain('LLM_API_KEY');
  });

  it('never includes variable values in the error message', () => {
    const message = errorMessageFor({
      ...validEnv,
      DATABASE_URL: 'secret-database-value',
      LLM_API_KEY: 'sk-secret-key',
      LLM_DAILY_BUDGET_USD: 'secret-budget',
    });

    expect(message).not.toContain('secret');
  });
});
