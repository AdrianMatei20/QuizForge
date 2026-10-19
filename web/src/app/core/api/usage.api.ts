import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { UsageReport } from './api.types';

@Injectable({ providedIn: 'root' })
export class UsageApi {
  private readonly http = inject(HttpClient);

  /** Inclusive UTC days, YYYY-MM-DD; the API defaults to the last 7 days. */
  report(range: { from: string; to: string }): Observable<UsageReport> {
    return this.http.get<UsageReport>('/api/usage', { params: range });
  }
}
