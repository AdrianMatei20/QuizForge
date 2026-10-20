import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { AppInfo } from './api.types';

@Injectable({ providedIn: 'root' })
export class InfoApi {
  private readonly http = inject(HttpClient);

  /** Whether the API runs in demo mode (fake LLM provider), and which sample lessons work then. */
  get(): Observable<AppInfo> {
    return this.http.get<AppInfo>('/api/info');
  }
}
