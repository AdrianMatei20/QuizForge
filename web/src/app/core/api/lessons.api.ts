import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { CreateLessonRequest, LessonResponse } from './api.types';

@Injectable({ providedIn: 'root' })
export class LessonsApi {
  private readonly http = inject(HttpClient);

  create(lesson: CreateLessonRequest): Observable<LessonResponse> {
    return this.http.post<LessonResponse>('/api/lessons', lesson);
  }
}
