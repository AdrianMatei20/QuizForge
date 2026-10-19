import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { AppError, appErrorFromProblem } from '../errors/app-error';

/** EventSource.CLOSED (HTML spec), without needing the global, which test DOMs lack. */
const EVENT_SOURCE_CLOSED = 2;

/** Creates the EventSource; replaced with a fake in tests. */
export const EVENT_SOURCE_FACTORY = new InjectionToken<(url: string) => EventSource>(
  'EVENT_SOURCE_FACTORY',
  { providedIn: 'root', factory: () => (url: string) => new EventSource(url) },
);

export interface EventStreamOptions<TName extends string> {
  /** Named events to emit, e.g. "question". */
  events: readonly TName[];
  /** The event after which the stream is complete. */
  completeOn: TName;
  /** The event carrying problem details: the stream errors with an AppError. */
  problemEvent: string;
}

/**
 * An EventSource as an Observable of `{ type, data }` (data parsed as JSON).
 *
 * - Completes after the `completeOn` event, and errors with an AppError on
 *   the problem event; both close the EventSource, so the browser does not
 *   reconnect to a finished stream.
 * - The browser's own `error` event only means the connection dropped:
 *   EventSource reconnects by itself (the server then replays what was
 *   missed), so it is ignored unless the browser gave up (CLOSED).
 * - Unsubscribing closes the EventSource. Use takeUntilDestroyed (or
 *   unsubscribe in ngOnDestroy) so a destroyed component stops listening.
 */
export function eventStream<TName extends string, TEvent extends { type: TName }>(
  createEventSource: (url: string) => EventSource,
  url: string,
  options: EventStreamOptions<TName>,
): Observable<TEvent> {
  return new Observable<TEvent>((subscriber) => {
    const source = createEventSource(url);

    const listeners: [string, (event: Event) => void][] = [
      ...options.events.map((name): [string, (event: Event) => void] => [
        name,
        (event) => {
          const data: unknown = JSON.parse((event as MessageEvent<string>).data);
          subscriber.next({ type: name, data } as unknown as TEvent);
          if (name === options.completeOn) {
            source.close();
            subscriber.complete();
          }
        },
      ]),
      [
        options.problemEvent,
        (event) => {
          const problem: unknown = JSON.parse((event as MessageEvent<string>).data);
          const status =
            typeof problem === 'object' && problem !== null && 'status' in problem
              ? Number(problem.status)
              : 0;
          source.close();
          subscriber.error(appErrorFromProblem(problem, status));
        },
      ],
      [
        'error',
        () => {
          if (source.readyState === EVENT_SOURCE_CLOSED) {
            subscriber.error(new AppError('network', 0, undefined));
          }
          // Otherwise the browser is reconnecting on its own.
        },
      ],
    ];

    for (const [name, listener] of listeners) {
      source.addEventListener(name, listener);
    }
    return () => {
      for (const [name, listener] of listeners) {
        source.removeEventListener(name, listener);
      }
      source.close();
    };
  });
}
