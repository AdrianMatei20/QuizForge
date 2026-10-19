import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  GenerateQuizRequest,
  QuizResponse,
  QuizStreamStartedResponse,
  ReviewStatsResponse,
} from './api.types';
import { EVENT_SOURCE_FACTORY, eventStream } from './event-stream';
import { PROBLEM_EVENT_NAME, QUIZ_STREAM_EVENT_NAMES, type QuizStreamEvent } from './stream-events';

@Injectable({ providedIn: 'root' })
export class QuizzesApi {
  private readonly http = inject(HttpClient);
  private readonly createEventSource = inject(EVENT_SOURCE_FACTORY);

  /** Synchronous on the API side: resolves once the quiz is generated and saved. */
  generate(lessonId: string, settings: GenerateQuizRequest): Observable<QuizResponse> {
    return this.http.post<QuizResponse>(`/api/lessons/${lessonId}/quizzes`, settings);
  }

  /** Starts a streamed generation: resolves at once (202) with the new quiz's id. */
  startStreaming(
    lessonId: string,
    settings: Omit<GenerateQuizRequest, 'stream'>,
  ): Observable<QuizStreamStartedResponse> {
    return this.http.post<QuizStreamStartedResponse>(`/api/lessons/${lessonId}/quizzes`, {
      ...settings,
      stream: true,
    });
  }

  /**
   * The quiz's generation events: saved questions first (replayed after a
   * reconnect), then live ones; completes on `done`, errors with an AppError
   * on `problem`. Unsubscribing closes the connection.
   */
  stream(quizId: string): Observable<QuizStreamEvent> {
    return eventStream<QuizStreamEvent['type'], QuizStreamEvent>(
      this.createEventSource,
      `/api/quizzes/${quizId}/stream`,
      {
        events: QUIZ_STREAM_EVENT_NAMES,
        completeOn: 'done',
        problemEvent: PROBLEM_EVENT_NAME,
      },
    );
  }

  get(quizId: string): Observable<QuizResponse> {
    return this.http.get<QuizResponse>(`/api/quizzes/${quizId}`);
  }

  reviewStats(quizId: string): Observable<ReviewStatsResponse> {
    return this.http.get<ReviewStatsResponse>(`/api/quizzes/${quizId}/review-stats`);
  }

  publish(quizId: string): Observable<QuizResponse> {
    return this.http.post<QuizResponse>(`/api/quizzes/${quizId}/publish`, {});
  }
}
