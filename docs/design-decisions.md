# Design decisions

Each decision with its reasoning and the alternative that was considered. The README lists them in one line each.

## LLM access

- **One way to call an LLM: `LlmModule`.** Every feature calls `LlmService.generate()` or `.stream()`; only `AnthropicLlmClient` imports the provider SDK, behind a small provider-neutral `LlmClient` interface. The budget guard, cache, retries, validation, repair, cost recording, metrics and tracing then apply to every call without any feature remembering them, and a fake client can stand in for the provider in every test. *Alternative:* calling the SDK from each feature, which spreads those concerns across the code base and makes tests depend on network mocks.
- **Model output is untrusted until it passes a zod schema and the rule checks, with one repair call.** The schema catches the wrong shape; the rules catch what a schema cannot (the quote must be in the lesson, no duplicate stems, the requested count). One repair call shows the model its own answer and exactly what was wrong. *Alternatives:* trusting structured output alone (it guarantees shape, not truth), or retrying until valid, which multiplies cost on a lesson the model cannot handle.
- **Prompts are versioned files** (`api/prompts/<id>/v<n>.md`), checked at startup, and every stored result records `prompt_id`, `prompt_version` and `model`. A prompt change is then a reviewable diff, and eval runs and questions say exactly which prompt made them. *Alternative:* prompt strings in code, where a change is invisible in the data.
- **Untrusted text is delimited** (`{{lesson | untrusted}}` becomes `<lesson>…</lesson>`, with closing tags inside escaped), and the system prompt says it is data, not instructions. The marker sits in the template, next to the text it protects, so a caller cannot forget it.
- **A daily budget guard reads the spend from `llm_calls`**, the same table that records every call, so there is one source of truth. *Alternative:* only the provider's spend limits, which stop the account, not the feature, and say nothing per feature. (It is a soft cap; see the known limitations.)
- **The cache key is a sha256 of canonical JSON** of feature, prompt, version, model, effort and variables, so no two different requests can collide by string joining, and key order does not matter. A Redis outage only disables the cache (it fails open). Quiz generation and regeneration turn it off, because a teacher asking again wants new questions; the eval judge keeps it on, so an unchanged question is judged once.
- **Money is a decimal everywhere it is stored or summed** (`numeric(12,6)` in PostgreSQL, decimal strings in the API, integer micro-dollars in code). *Alternative:* floats, which drift when thousands of small costs are summed. The one exception is the Prometheus cost counter, which is a float for graphs only.

## API

- **Every error is RFC 9457 problem details from one global filter**, with field errors located by JSON Pointer (`#/options/3`) or parameter name. Clients get one error shape to handle, and the web app maps it to a typed `AppError`. *Alternative:* Nest's default error bodies, which differ between validation, HTTP and unexpected errors.
- **Configuration is validated by a zod schema at startup**, and the app refuses to start on invalid config, naming each bad variable but never its value.
- **Answer options are shuffled before saving**, with `correctIndex` updated and the model's order kept in `original`, so the answer's position carries no signal and position bias can still be measured.
- **The public quiz has its own response class**, mapped field by field, rather than the teacher's response with fields removed: a field added to the teacher's response later cannot leak the answers. Scoring happens on the server, so a client can never claim its own score.

## Streaming

- **JSON Lines over Server-Sent Events.** The model writes one question per line, so each question can be validated and saved the moment its line is complete, and the review board shows it at once. *Alternatives:* streaming one big JSON document (nothing can be validated until the end) or WebSockets (two-way, which this flow does not need, and harder to proxy and replay).
- **Generation runs in the background, decoupled from the connection.** Disconnecting never stops it, and a client that reconnects first gets every saved question again from the database, then the live events. A sweep cleans up quizzes left `generating` by a crash.
- **One repair step after the stream**, for each missing or rejected position, with the regenerate prompt: the quiz becomes a draft with whatever could be saved, rather than failing as a whole.

## Web

- **Angular with standalone components, signals and Signal Forms, plain SCSS, no UI component library.** Every part of the UI is ordinary code that can be read and explained. Approve and reject are optimistic, with a rollback on error.
- **Model output is rendered as text, never HTML.** `npm run lint` fails on `[innerHTML]`, `[outerHTML]` and `bypassSecurityTrust*`.

## Observability

- **OpenTelemetry directly, not `@nestjs/observe`.** `@nestjs/observe` (0.3.13 when evaluated in October 2026) is an agent for a hosted service that needs an account and its own wire format rather than OTLP, and it was pre-1.0 and releasing several times a week. The OpenTelemetry SDK is vendor-neutral: the same OTLP export works with the local Collector and Tempo, or any other backend.
- **A Nest tracing interceptor instead of the Nest auto-instrumentation**, because `@opentelemetry/instrumentation-nestjs-core` does not support `@nestjs/core` 12 yet. HTTP and PostgreSQL still use the official instrumentations; the interceptor can go when the official one catches up.
- **Metrics and the span are recorded in `LlmService`**, next to the `llm_calls` row, so the database, Prometheus and the trace always agree, and a new feature gets them for free.

## Rate limiting

- **One counter per client IP for generate and regenerate together**, because both cost LLM calls. `@nestjs/throttler` counts each handler separately by default, which would allow 10 quizzes and 10 regenerations a minute. Attempts have their own limit. Each endpoint says which limit it uses (`@GenerateRateLimit()`, `@AttemptRateLimit()`), because the throttler applies every configured limit to a guarded route unless the others are skipped.
- **`TRUST_PROXY_HOPS`** makes the client IP come from `X-Forwarded-For` behind a known number of proxies (1 behind the web container's nginx). Without it, every client would share the proxy's limit; trusting only a fixed number of hops keeps clients from spoofing their address.

## Evals

- **The eval harness calls the production pipeline, not a copy of it**: `buildQuizRequest()` through `LlmService`, so it measures the same schema, rules and repair a teacher gets. To see the first answer before repair, `LlmService` reports each validation through an `onValidation` callback. *Alternative:* returning it in the result, which loses it whenever the call fails.
- **The judge does not see the explanation or the source quote**, only the lesson and the question with its marked answer, so it checks the answer against the lesson rather than the generator's own justification.
- **Questions and the judge's reasons live in committed report files; the database keeps numbers only** (`eval_runs.metrics`), which is all the run list and the comparison need.
- **The judge is checked against a human**: `eval:sample` and `eval:agreement` report agreement and Cohen's kappa, which corrects for agreement by chance when most questions pass.

## Running it

- **Demo mode instead of a required API key.** With the fake provider, each sample lesson is answered with its own fixtures (found by content hash), and any other lesson gets a 422 with a clear message before anything is stored. *Alternative:* letting other lessons fail later as invalid model output (502), which looks like a bug.
- **The Docker stack uses its own database (`quizforge_demo`)**, created on first start, so demo data never mixes with local development. The API container migrates on start and runs as an unprivileged user; secrets reach it only as environment variables at run time, never in the image.
- **The demo seed is safe to run on every start**: lessons are matched by content hash, the published quiz is only added when the lesson has none, everything is one transaction, and a PostgreSQL advisory lock keeps two starting containers from seeding at once.
