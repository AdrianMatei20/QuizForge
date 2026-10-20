import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { AttemptResult, PublicQuiz, SubmitAttemptRequest } from './api.types';

/** What a student uses: no login, and the quiz never includes the answers. */
@Injectable({ providedIn: 'root' })
export class PublicQuizzesApi {
  private readonly http = inject(HttpClient);

  get(quizId: string): Observable<PublicQuiz> {
    return this.http.get<PublicQuiz>(`/api/public/quizzes/${quizId}`);
  }

  /** Scored on the server; the result carries the correct answers and explanations. */
  submitAttempt(quizId: string, attempt: SubmitAttemptRequest): Observable<AttemptResult> {
    return this.http.post<AttemptResult>(`/api/public/quizzes/${quizId}/attempts`, attempt);
  }
}
