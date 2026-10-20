import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { EvalComparison, EvalRunList } from './api.types';

@Injectable({ providedIn: 'root' })
export class EvalsApi {
  private readonly http = inject(HttpClient);

  /** Newest first. Dry runs (fake provider, meaningless numbers) only when asked for. */
  list(options: { includeDryRuns: boolean }): Observable<EvalRunList> {
    return this.http.get<EvalRunList>('/api/evals', {
      params: { includeDryRuns: options.includeDryRuns },
    });
  }

  /** Run b against baseline run a, metric by metric. */
  compare(a: string, b: string): Observable<EvalComparison> {
    return this.http.get<EvalComparison>('/api/evals/compare', { params: { a, b } });
  }
}
