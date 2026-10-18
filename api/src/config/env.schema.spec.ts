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
