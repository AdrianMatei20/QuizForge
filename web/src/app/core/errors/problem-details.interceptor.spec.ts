import { HttpClient, HttpHeaders, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { AppError } from './app-error';
import { problemDetailsInterceptor } from './problem-details.interceptor';

const PROBLEM = 'urn:quizforge:problem:';

describe('problemDetailsInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([problemDetailsInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  /** Sends a request, answers it with the given error response, returns what the caller got. */
  async function failWith(
    body: object | string,
    status: number,
    headers: Record<string, string> = {},
  ): Promise<AppError> {
    const result = firstValueFrom(http.get('/api/thing')).catch((error: unknown) => error);
    controller.expectOne('/api/thing').flush(body, {
      status,
      statusText: 'Error',
      headers: new HttpHeaders({ 'Content-Type': 'application/problem+json', ...headers }),
    });
    const error = await result;
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }

  it('maps a validation problem, keeping pointer and parameter field errors', async () => {
    const error = await failWith(
      {
        type: `${PROBLEM}validation-error`,
        title: 'Validation failed',
        status: 400,
        detail: 'The edited question breaks the quiz rules.',
        errors: [
          { pointer: '#/options/1', detail: 'question 1: options 1 and 2 are identical' },
          { parameter: 'limit', detail: 'limit must not be greater than 100' },
        ],
      },
      400,
    );

    expect(error.kind).toBe('validation');
    expect(error.status).toBe(400);
    expect(error.detail).toBe('The edited question breaks the quiz rules.');
    expect(error.fieldErrors).toEqual([
      { pointer: '#/options/1', detail: 'question 1: options 1 and 2 are identical' },
      { parameter: 'limit', detail: 'limit must not be greater than 100' },
    ]);
    expect(error.retryable).toBe(false);
  });

  it.each([
    ['llm-invalid-output', 502, 'invalid-output'],
    ['llm-output-truncated', 502, 'invalid-output'],
    ['llm-upstream-error', 502, 'provider-error'],
    ['llm-timeout', 504, 'timeout'],
    ['llm-refused', 422, 'refused'],
    ['lesson-too-large', 413, 'too-large'],
  ] as const)('maps %s (%i) to kind "%s"', async (type, status, kind) => {
    const error = await failWith(
      { type: `${PROBLEM}${type}`, title: 'x', status, detail: 'x' },
      status,
    );

    expect(error.kind).toBe(kind);
  });

  it('marks invalid model output as retryable and keeps the failed quiz id', async () => {
    const error = await failWith(
      {
        type: `${PROBLEM}llm-invalid-output`,
        title: 'AI output rejected',
        status: 502,
        detail: 'The AI returned output that failed validation.',
        quizId: '0b6c3c8e-1f4a-4f0e-9a3e-5d2f8c7b9a10',
        errors: [{ detail: 'question 2: sourceQuote does not appear in the lesson' }],
      },
      502,
    );

    expect(error.kind).toBe('invalid-output');
    expect(error.retryable).toBe(true);
    expect(error.extras.quizId).toBe('0b6c3c8e-1f4a-4f0e-9a3e-5d2f8c7b9a10');
  });

  it('reads Retry-After for the budget guard', async () => {
    const error = await failWith(
      {
        type: `${PROBLEM}llm-budget-exceeded`,
        title: 'AI budget exceeded',
        status: 429,
        detail: 'x',
      },
      429,
      { 'Retry-After': '32400' },
    );

    expect(error.kind).toBe('budget-exceeded');
    expect(error.extras.retryAfterSeconds).toBe(32_400);
    expect(error.retryable).toBe(false);
  });

  it('falls back to the status for problem types without a special meaning', async () => {
    const conflict = await failWith(
      {
        type: `${PROBLEM}quiz-published`,
        title: 'Quiz is published',
        status: 409,
        detail: 'A published quiz and its questions can no longer be changed.',
      },
      409,
    );
    const notFound = await failWith(
      { type: 'about:blank', title: 'Not Found', status: 404, detail: 'Quiz 1 was not found' },
      404,
    );

    expect(conflict.kind).toBe('conflict');
    expect(conflict.detail).toBe('A published quiz and its questions can no longer be changed.');
    expect(notFound.kind).toBe('not-found');
  });

  it('maps a response that is not problem details by its status, without its body', async () => {
    const error = await failWith('<html>Bad gateway</html>', 502, { 'Content-Type': 'text/html' });

    expect(error.kind).toBe('server');
    expect(error.detail).toBeUndefined();
    expect(error.message).not.toContain('html');
  });

  it('maps a network failure to a retryable "network" error', async () => {
    const result = firstValueFrom(http.get('/api/thing')).catch((error: unknown) => error);
    controller.expectOne('/api/thing').error(new ProgressEvent('error'), { status: 0 });

    const error = (await result) as AppError;

    expect(error).toBeInstanceOf(AppError);
    expect(error.kind).toBe('network');
    expect(error.retryable).toBe(true);
  });

  it('passes successful responses through untouched', async () => {
    const result = firstValueFrom(http.get('/api/thing'));
    controller.expectOne('/api/thing').flush({ ok: true });

    expect(await result).toEqual({ ok: true });
  });
});
