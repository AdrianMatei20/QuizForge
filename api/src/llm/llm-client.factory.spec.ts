import { AnthropicLlmClient } from './anthropic-llm.client.js';
import { FakeLlmClient } from './fake-llm.client.js';
import { createLlmClient } from './llm-client.factory.js';

describe('createLlmClient', () => {
  it('creates the fake client for LLM_PROVIDER=fake', () => {
    expect(
      createLlmClient({ LLM_PROVIDER: 'fake', LLM_API_KEY: undefined }),
    ).toBeInstanceOf(FakeLlmClient);
  });

  it('creates the Anthropic client for LLM_PROVIDER=anthropic', () => {
    expect(
      createLlmClient({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'sk-test' }),
    ).toBeInstanceOf(AnthropicLlmClient);
  });

  it('refuses the Anthropic client without an API key', () => {
    expect(() =>
      createLlmClient({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: undefined }),
    ).toThrow('LLM_API_KEY is required');
  });
});
