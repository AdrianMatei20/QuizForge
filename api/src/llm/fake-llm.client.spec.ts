import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wrapUntrusted } from './prompt-registry.js';
import { lessonContentHash } from '../lessons/lesson-content.js';
import { loadSampleLessons } from '../lessons/sample-lessons.js';
import { DEFAULT_FIXTURES_DIR, FakeLlmClient } from './fake-llm.client.js';
import {
  LlmProviderError,
  type LlmRequest,
  type LlmStreamEvent,
} from './llm-client.js';

const request: LlmRequest = {
  promptId: 'test-quiz',
  model: 'fake-model',
  system: 'sys',
  messages: [{ role: 'user', content: 'Write questions.' }],
  maxTokens: 100,
  timeoutMs: 1_000,
};

async function collect(events: AsyncIterable<LlmStreamEvent>) {
  const collected: LlmStreamEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

describe('FakeLlmClient', () => {
  describe('demo mode: fixtures per sample lesson', () => {
    const samples = new Map(
      loadSampleLessons().map((lesson) => [lesson.contentHash, lesson.name]),
    );
    const fixture = (promptId: string, name: string) =>
      readFileSync(join(DEFAULT_FIXTURES_DIR, promptId, `${name}.txt`), 'utf8');
    const quizRequest = (lesson: string): LlmRequest => ({
      ...request,
      promptId: 'quiz',
      messages: [
        {
          role: 'user',
          content: `Write 5 questions.

${wrapUntrusted('lesson', lesson)}`,
        },
      ],
    });
    const binarySearch = loadSampleLessons().find(
      (l) => l.name === 'binary-search',
    );
    if (!binarySearch) throw new Error('binary-search sample missing');

    it('answers a sample lesson with its own fixture, found by content hash', async () => {
      const client = new FakeLlmClient({ sampleLessons: samples });

      const response = await client.generate(quizRequest(binarySearch.content));

      expect(lessonContentHash(binarySearch.content)).toBe(
        binarySearch.contentHash,
      );
      expect(response.text).toBe(fixture('quiz', 'binary-search'));
    });

    it('falls back to default.txt for another lesson, or a prompt without a fixture for the sample', async () => {
      const client = new FakeLlmClient({ sampleLessons: samples });

      const other = await client.generate(
        quizRequest('A lesson nobody has seen.'),
      );
      const judge = await client.generate({
        ...quizRequest(binarySearch.content),
        promptId: 'judge',
      });

      expect(other.text).toBe(fixture('quiz', 'default'));
      expect(judge.text).toBe(fixture('judge', 'default'));
    });

    it('still lets a queued fixture win', async () => {
      const client = new FakeLlmClient({ sampleLessons: samples });
      client.respondWithFixture('http-caching');

      const response = await client.generate(quizRequest(binarySearch.content));

      expect(response.text).toBe(fixture('quiz', 'http-caching'));
    });
  });

  it('answers with the default fixture of the prompt', async () => {
    const response = await new FakeLlmClient().generate(request);

    expect(response.text).toContain('"questions"');
    expect(response.stopReason).toBe('complete');
  });

  it('estimates usage deterministically at about 4 characters per token', async () => {
    const client = new FakeLlmClient().respondNext('12345678');

    const response = await client.generate(request);

    // input: "sys" + "Write questions." = 19 chars -> 5 tokens; output: 8 chars -> 2 tokens
    expect(response.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
  });

  it('uses queued steps once each, in order, then falls back to the fixture', async () => {
    const client = new FakeLlmClient()
      .respondNext('first', { inputTokens: 1, outputTokens: 2 })
      .respondWithFixture('fenced');

    expect((await client.generate(request)).text).toBe('first');
    expect((await client.generate(request)).text).toContain('```json');
    expect((await client.generate(request)).text).toContain('"questions"');
  });

  it('simulates refusals and truncation through the stop reason', async () => {
    const client = new FakeLlmClient().nextRefusal().nextTruncated();

    expect((await client.generate(request)).stopReason).toBe('refusal');
    expect((await client.generate(request)).stopReason).toBe('max_tokens');
    expect((await client.generate(request)).stopReason).toBe('complete');
  });

  it('adds a Retry-After to failures only when asked', async () => {
    const client = new FakeLlmClient()
      .failNext(1, 'server', { retryAfterSeconds: 4 })
      .failNext(1, 'rate_limited');

    await expect(client.generate(request)).rejects.toMatchObject({
      kind: 'server',
      retryAfterSeconds: 4,
    });
    await expect(client.generate(request)).rejects.toMatchObject({
      kind: 'rate_limited',
      retryAfterSeconds: undefined,
    });
  });

  it('fails the next N calls with the chosen provider error', async () => {
    const client = new FakeLlmClient().failNext(2, 'rate_limited');

    for (let i = 0; i < 2; i++) {
      await expect(client.generate(request)).rejects.toMatchObject({
        kind: 'rate_limited',
        status: 429,
      });
    }
    await expect(client.generate(request)).resolves.toBeDefined();
  });

  it.each([
    ['server', 'server', 500],
    ['timeout', 'timeout', undefined],
    ['bad_request', 'client', 400],
  ] as const)(
    'maps the %s failure to a %s provider error',
    async (failure, kind, status) => {
      const error = await new FakeLlmClient()
        .failNext(1, failure)
        .generate(request)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(LlmProviderError);
      expect(error).toMatchObject({ kind, status });
    },
  );

  it('returns malformed and off-schema JSON on request', async () => {
    const client = new FakeLlmClient().nextMalformedJson().nextOffSchema();

    const malformed = (await client.generate(request)).text;
    const offSchema = (await client.generate(request)).text;

    expect(() => JSON.parse(malformed) as unknown).toThrow();
    expect(JSON.parse(offSchema)).toEqual({ unexpected: true });
  });

  it('captures every request', async () => {
    const client = new FakeLlmClient().failNext(1, 'server');
    await client.generate(request).catch(() => undefined);
    await client.generate({ ...request, model: 'other' });

    expect(client.requests.map((r) => r.model)).toEqual([
      'fake-model',
      'other',
    ]);
  });

  it('streams a fixture in small chunks, then reports usage', async () => {
    const client = new FakeLlmClient({ chunkSize: 5 }).respondNext(
      'abcdefghijkl',
      {
        inputTokens: 3,
        outputTokens: 4,
      },
    );

    const events = await collect(client.stream(request));

    expect(events).toEqual([
      { type: 'start', inputTokens: 3 },
      { type: 'text', text: 'abcde' },
      { type: 'text', text: 'fghij' },
      { type: 'text', text: 'kl' },
      {
        type: 'done',
        usage: { inputTokens: 3, outputTokens: 4 },
        stopReason: 'complete',
      },
    ]);
  });

  it('streams the default fixture so the chunks add up to the whole text', async () => {
    const client = new FakeLlmClient();
    const whole = (await client.generate(request)).text;

    const events = await collect(client.stream(request));
    const streamed = events
      .flatMap((e) => (e.type === 'text' ? [e.text] : []))
      .join('');

    expect(streamed).toBe(whole);
    expect(events.filter((e) => e.type === 'text').length).toBeGreaterThan(1);
  });

  it('rejects an already aborted request', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      new FakeLlmClient().generate({ ...request, signal: controller.signal }),
    ).rejects.toThrow();
  });

  it('explains a missing fixture', async () => {
    await expect(
      new FakeLlmClient().generate({ ...request, promptId: 'no-such-prompt' }),
    ).rejects.toThrow('FakeLlmClient has no fixture at');
  });
});
