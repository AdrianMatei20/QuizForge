/**
 * OpenTelemetry tracing, preloaded before the app (ESM instrumentation must
 * be registered before the modules it patches are imported):
 *
 *   node --experimental-loader=@opentelemetry/instrumentation/hook.mjs \
 *        --import ./dist/telemetry.js dist/main.js
 *
 * (npm run start:prod / start:traced). This follows the OpenTelemetry JS
 * ESM guide (doc/esm-support.md): the loader flag is still required there.
 *
 * Tracing is off unless OTEL_EXPORTER_OTLP_ENDPOINT is set: then nothing is
 * started and the @opentelemetry/api calls in the app are no-ops.
 *
 * Instrumented automatically: incoming and outgoing HTTP, and pg. The Nest
 * instrumentation (@opentelemetry/instrumentation-nestjs-core, <=0.70.0)
 * only supports @nestjs/core <12, so Nest handler spans come from
 * TracingInterceptor instead, and LLM calls get a manual llm.generate span.
 */
import { existsSync } from 'node:fs';

// This runs before Nest's ConfigModule, so read api/.env here too, if it
// exists. process.loadEnvFile never overrides a variable that is already
// set in the real environment (even to an empty string).
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];

if (endpoint) {
  const [
    { NodeSDK },
    { OTLPTraceExporter },
    { HttpInstrumentation },
    { PgInstrumentation },
  ] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/instrumentation-http'),
    import('@opentelemetry/instrumentation-pg'),
  ]);

  const sdk = new NodeSDK({
    serviceName: process.env['OTEL_SERVICE_NAME'] ?? 'quizforge-api',
    // Reads OTEL_EXPORTER_OTLP_ENDPOINT and appends /v1/traces.
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation({
        // Scrapes and probes would drown out real traffic.
        ignoreIncomingRequestHook: (request) =>
          request.url === '/metrics' || request.url === '/health',
      }),
      new PgInstrumentation(),
    ],
  });
  sdk.start();
  console.log(`Tracing on: exporting OTLP to ${endpoint}`);

  // Flush buffered spans when the process is asked to stop.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void sdk.shutdown();
    });
  }
}
