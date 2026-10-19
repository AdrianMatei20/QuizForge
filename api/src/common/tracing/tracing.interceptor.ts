import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Request } from 'express';
import { finalize, Observable, tap } from 'rxjs';

/**
 * One span per controller handler, named after the code ("QuizzesController.
 * generate"), as a child of the incoming HTTP span. It stands in for the
 * OpenTelemetry Nest instrumentation, which does not support Nest 12.
 * Without a registered SDK (see src/telemetry.ts) the spans are no-ops.
 */
export class TracingInterceptor implements NestInterceptor {
  private readonly tracer = trace.getTracer('quizforge.nest');

  intercept(
    executionContext: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    if (executionContext.getType() !== 'http') {
      return next.handle();
    }
    const controller = executionContext.getClass().name;
    const handler = executionContext.getHandler().name;
    const request = executionContext.switchToHttp().getRequest<Request>();
    const span = this.tracer.startSpan(`${controller}.${handler}`, {
      attributes: {
        'nest.controller': controller,
        'nest.handler': handler,
        // The route pattern, never the URL with ids (it would explode cardinality).
        'http.route':
          (request.route as { path?: string } | undefined)?.path ?? '',
      },
    });
    const spanContext = trace.setSpan(context.active(), span);

    // The handler runs when the Observable is subscribed to, so subscribe
    // inside the span's context: spans it starts (pg, llm.generate) nest under it.
    return new Observable((subscriber) =>
      context.with(spanContext, () =>
        next
          .handle()
          .pipe(
            tap({
              error: (error: unknown) =>
                // The error's class only: a message could quote model output.
                span.setStatus({
                  code: SpanStatusCode.ERROR,
                  message: error instanceof Error ? error.name : 'error',
                }),
            }),
            finalize(() => span.end()),
          )
          .subscribe(subscriber),
      ),
    );
  }
}
