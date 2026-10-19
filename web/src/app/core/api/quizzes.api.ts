import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { GenerateQuizRequest, QuizResponse, ReviewStatsResponse } from './api.types';

@Injectable({ providedIn: 'root' })
export class QuizzesApi {
  private readonly http = inject(HttpClient);

  /** Synchronous on the API side: resolves once the quiz is generated and saved. */
  generate(lessonId: string, settings: GenerateQuizRequest): Observable<QuizResponse> {
    return this.http.post<QuizResponse>(`/api/lessons/${lessonId}/quizzes`, settings);
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
