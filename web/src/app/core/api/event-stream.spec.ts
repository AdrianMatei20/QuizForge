import { AppError } from '../errors/app-error';
import { eventStream } from './event-stream';
import { PROBLEM_EVENT_NAME, QUIZ_STREAM_EVENT_NAMES, type QuizStreamEvent } from './stream-events';

/** Just enough of EventSource to drive the wrapper from a test. */
export class FakeEventSource {
  readyState = 1; // OPEN
  closed = false;
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();

  constructor(readonly url: string) {}

  addEventListener(name: string, listener: (event: Event) => void): void {
    const set = this.listeners.get(name) ?? new Set();
    set.add(listener);
    this.listeners.set(name, set);
  }

  removeEventListener(name: string, listener: (event: Event) => void): void {
    this.listeners.get(name)?.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  /** A named server event with a JSON payload. */
  emit(name: string, data: unknown): void {
    const event = new MessageEvent(name, { data: JSON.stringify(data) });
    this.listeners.get(name)?.forEach((listener) => listener(event));
  }

  /** The browser's own connection error event (no data). */
  connectionError(readyState: number): void {
    this.readyState = readyState;
    this.listeners.get('error')?.forEach((listener) => listener(new Event('error')));
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

const QUESTION = {
  id: 'q1',
  position: 1,
  type: 'true_false',
  stem: 'Recursion needs a base case.',
  options: ['True', 'False'],
  correctIndex: 0,
  explanation: 'x',
  sourceQuote: 'y',
  status: 'draft',
  editedAt: null,
  isEdited: false,
};

describe('eventStream', () => {
  let source: FakeEventSource;
  let events: QuizStreamEvent[];
  let completed: boolean;
  let failure: unknown;

  const subscribe = () =>
    eventStream<QuizStreamEvent['type'], QuizStreamEvent>(
      (url) => {
        source = new FakeEventSource(url);
        return source as unknown as EventSource;
      },
      '/api/quizzes/quiz-1/stream',
      { events: QUIZ_STREAM_EVENT_NAMES, completeOn: 'done', problemEvent: PROBLEM_EVENT_NAME },
    ).subscribe({
      next: (event) => events.push(event),
      complete: () => (completed = true),
      error: (error: unknown) => (failure = error),
    });

  beforeEach(() => {
    events = [];
    completed = false;
    failure = undefined;
  });

  it('emits named events with parsed data, and completes and closes on done', () => {
    subscribe();
    expect(source.url).toBe('/api/quizzes/quiz-1/stream');

    source.emit('question', QUESTION);
    source.emit('question_rejected', { position: 2, violations: ['question 2: x'] });
    expect(completed).toBe(false);
    source.emit('done', { generated: 1, rejected: 1, usage: {} });

    expect(events.map((event) => event.type)).toEqual(['question', 'question_rejected', 'done']);
    expect(events[0]?.data).toEqual(QUESTION);
    expect(completed).toBe(true);
    expect(source.closed).toBe(true);
  });

  it('errors with an AppError and closes on a problem event', () => {
    subscribe();

    source.emit('problem', {
      type: 'urn:quizforge:problem:llm-budget-exceeded',
      title: 'AI budget exceeded',
      status: 429,
      detail: "Today's budget for AI generation is used up.",
      quizId: 'quiz-1',
    });

    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).kind).toBe('budget-exceeded');
    expect((failure as AppError).extras.quizId).toBe('quiz-1');
    expect(source.closed).toBe(true);
  });

  it('ignores a dropped connection while the browser reconnects', () => {
    subscribe();

    source.connectionError(0); // CONNECTING: EventSource retries by itself

    expect(failure).toBeUndefined();
    expect(source.closed).toBe(false);
    source.emit('question', QUESTION);
    expect(events).toHaveLength(1);
  });

  it('errors with a network AppError when the browser gives up', () => {
    subscribe();

    source.connectionError(2); // CLOSED

    expect((failure as AppError).kind).toBe('network');
  });

  it('closes the EventSource and removes its listeners when unsubscribed', () => {
    const subscription = subscribe();
    expect(source.listenerCount()).toBeGreaterThan(0);

    subscription.unsubscribe();

    expect(source.closed).toBe(true);
    expect(source.listenerCount()).toBe(0);
  });
});
