# Usage, metrics and traces

What the LLM calls cost and how they behave: the usage endpoint and page, Prometheus metrics, OpenTelemetry traces, and the Grafana stack.

## Usage

`GET /api/usage` sums `llm_calls` by UTC day and feature. The response has `totals` and a `days` array (sorted by day, then feature), and every bucket has the same shape:

- `calls`, `inputTokens`, `outputTokens`, `costUsd` (a decimal string, summed exactly);
- `cacheHitRate` and `errorRate` (calls whose status is not `ok`), or `null` with no calls;
- `byStatus`: a count for each status (`ok`, `invalid_output`, `error`, `budget_exceeded`, `refused`, `truncated`), zeros included;
- `estimated`: the calls, tokens and cost that were estimated (see Aborted streams above), already included in the main figures.

An invalid range (bad date, `from` after `to`, more than 366 days) returns 400 with a `{ parameter, detail }` entry.

## Metrics and traces

Every LLM call, cached or not, is recorded inside `LlmService`, so no caller can skip it.

**Metrics.** `GET /metrics` serves, from the API's own prom-client registry:

| Metric | Labels | What it counts |
| ------ | ------ | -------------- |
| `llm_requests_total` | `feature`, `status` | LLM calls, by outcome |
| `llm_latency_seconds` | `feature` | Histogram of call latency, retries included (buckets from 0.25 s to 120 s) |
| `llm_tokens_total` | `feature`, `direction` (`input`, `output`) | Tokens |
| `llm_cost_usd_total` | `feature` | Cost in USD |

plus the default Node.js process metrics. `llm_cost_usd_total` is a float, which is fine for a graph; the exact cost stays a decimal in `llm_calls` and in `/api/usage`.

**Traces.** Tracing is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set. With it, the API exports OTLP over HTTP spans for incoming HTTP requests, each Nest controller handler, PostgreSQL queries, and one `llm.generate` span per LLM call. That span carries `llm.feature`, `llm.model`, `llm.prompt_id`, `llm.prompt_version`, `llm.streamed`, `llm.input_tokens`, `llm.output_tokens`, `llm.cache_hit`, `llm.attempts`, `llm.status` and `llm.usage_estimated`, and never the prompt or the model output.

Tracing needs the instrumentation loaded before the app, so it only works with the compiled app:

```bash
# 1. Prometheus (9090), Grafana (3030), OTel Collector (OTLP/HTTP on 4318) and Tempo
docker compose --profile observability up -d

# 2. The API with tracing on (builds first)
cd api
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run start:traced
```

`npm run start:traced` runs `node --experimental-loader=@opentelemetry/instrumentation/hook.mjs --import ./dist/telemetry.js dist/main.js`. `telemetry.ts` reads `api/.env` itself (if it exists, and without overriding variables already set in the environment), because it runs before Nest's config module.

Open http://localhost:3030 (Grafana, no login locally). The home dashboard, **QuizForge LLM**, shows LLM request rate, p95 latency, tokens and cost by feature, and error rate. Prometheus scrapes the API at `host.docker.internal:3000/metrics` every 15 seconds, so it works with `npm run start:dev` too. For traces, open **Explore**, choose **Tempo** and search with TraceQL, e.g. `{ name = "llm.generate" }`. `docker compose --profile observability stop` stops the stack and leaves PostgreSQL and Redis running.
