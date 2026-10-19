import type { HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { toAppError } from './app-error';

/** Every failed request errors with an AppError instead of an HttpErrorResponse. */
export const problemDetailsInterceptor: HttpInterceptorFn = (request, next) =>
  next(request).pipe(catchError((error: unknown) => throwError(() => toAppError(error))));
