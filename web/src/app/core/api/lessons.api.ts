import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { CreateLessonRequest, LessonList, LessonResponse } from './api.types';

@Injectable({ providedIn: 'root' })
export class LessonsApi {
  private readonly http = inject(HttpClient);

  create(lesson: CreateLessonRequest): Observable<LessonResponse> {
    return this.http.post<LessonResponse>('/api/lessons', lesson);
  }

  get(lessonId: string): Observable<LessonResponse> {
    return this.http.get<LessonResponse>(`/api/lessons/${lessonId}`);
  }

  /** Newest first, without their content. */
  list(page: { limit: number; offset: number }): Observable<LessonList> {
    return this.http.get<LessonList>('/api/lessons', {
      params: { limit: page.limit, offset: page.offset },
    });
  }
}
