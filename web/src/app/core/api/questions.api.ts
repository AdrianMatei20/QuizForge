import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { QuestionResponse, UpdateQuestionRequest } from './api.types';

@Injectable({ providedIn: 'root' })
export class QuestionsApi {
  private readonly http = inject(HttpClient);

  /** Edits content and/or changes the status. */
  update(questionId: string, changes: UpdateQuestionRequest): Observable<QuestionResponse> {
    return this.http.patch<QuestionResponse>(`/api/questions/${questionId}`, changes);
  }

  /** Resolves with the replacement question (a new id, same position). */
  regenerate(questionId: string): Observable<QuestionResponse> {
    return this.http.post<QuestionResponse>(`/api/questions/${questionId}/regenerate`, {});
  }
}
