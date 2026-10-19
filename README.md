# QuizForge

QuizForge turns a lesson into a reviewed quiz. An LLM drafts quiz questions, a teacher approves, edits, rejects or regenerates them, and an eval harness measures prompt quality.

> Status: Phase 2 (lessons and synchronous quiz generation). The API can store a lesson and generate a draft quiz from it; there is no web UI for it yet.

## Roadmap

- [x] Phase 0: Scaffold (NestJS API, Angular app, PostgreSQL and Redis via Docker Compose, config validation, problem-details errors, health check)
- [x] Phase 1: LLM foundation (LlmModule, prompt registry, daily budget, Redis cache, retries with backoff, output validation and repair, per-call cost tracking)
- [x] Phase 2: Lessons and synchronous quiz generation (lessons, quizzes and questions tables, quiz prompt v1, rule checks, sample lessons)

## Repository layout

| Path                 | What it is                                                         |
| -------------------- | ------------------------------------------------------------------ |
| `api/`               | NestJS API (TypeScript, TypeORM + PostgreSQL, Redis)               |
| `api/src/llm/`       | LlmModule: the only way the API talks to an LLM                    |
| `api/prompts/`       | Prompt files, `<promptId>/v<n>.md`                                 |
| `api/config/`        | `llm-pricing.json`: USD per million tokens, per model              |
| `api/src/lessons/`   | Lessons: create and read                                           |
| `api/src/quiz/`      | Quizzes: generation, output schema, rule checks                    |
| `api/fixtures/`      | Sample lessons (recursion, binary search, HTTP caching)            |
| `web/`               | Angular app (standalone components, signals)                       |
| `docker-compose.yml` | Local PostgreSQL and Redis                                         |
| `docker/`            | Container init scripts (creates the `quizforge_test` database)     |

## Prerequisites

- Node.js 22 or newer
- Docker with Docker Compose v2

## Run it locally

```bash
# 1. Infrastructure (PostgreSQL on 5432, Redis on 6379, bound to localhost)
docker compose up -d

# 2. API on http://localhost:3000
cd api
npm install
cp .env.example .env        # defaults use LLM_PROVIDER=fake, so no API key is needed
npm run migration:run
npm run start:dev

# 3. Web app on http://localhost:4200 (in another terminal)
cd web
npm install
npm start
```

Check that everything is up:

```bash
curl http://localhost:3000/health      # 200 with postgres and redis "up"
curl http://localhost:4200/api/x       # proxied to the API: a 404 problem-details response
```

`GET /health` returns 503 (as problem details, with a `checks` member) when a dependency is down.

## Configuration

All API configuration comes from environment variables, validated at startup by a zod schema in
`api/src/config/env.schema.ts`. See `api/.env.example` for every variable. If anything is invalid,
the API refuses to start and names each bad variable (never its value), for example:

```text
Error: Invalid environment configuration:
  - LLM_API_KEY: is required unless LLM_PROVIDER is "fake"
```

## API

All feature routes are under `/api`.

| Method and path                 | What it does                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `POST /api/lessons`             | `{ title, content }`. Content must be 200 to 20,000 characters (400 if shorter, 413 if longer) |
| `GET /api/lessons/:id`          | Read a lesson                                                                 |
| `POST /api/lessons/:id/quizzes` | `{ count: 3-10, difficulty: easy \| medium \| hard, types: [multiple_choice, true_false] }`. Generates the quiz synchronously and returns it with its draft questions |
| `GET /api/lessons/:id/quizzes`  | The lesson's quizzes, newest first, without questions: `{ id, status, failureReason, settings, createdAt }`. `?limit=` from 1 to 100 (default 20) |
| `GET /api/quizzes/:id`          | Read a quiz with its questions, in order. A failed quiz has a `failureReason` |
| `GET /api/quizzes/:id/cost`     | `{ quizId, calls, attempts, inputTokens, outputTokens, totalTokens, costUsd }` summed over every LLM call made for the quiz, failed ones included |

Generated questions must pass the zod output schema and the rule checks in `api/src/quiz/rules.ts`:
- distinct options;
- `correctIndex` in range;
- no "all/none of the above";
- no duplicate stems;
- every `sourceQuote` at least `QUIZ_SOURCE_QUOTE_MIN_WORDS` words long (default 5) and found in the lesson;
- the requested count and types.

If a quiz still fails after the one repair call, it is saved with status `failed` and the request returns 502. Each question keeps the model's original output in `original`.

When generation fails, the error response includes a `quizId` member, so the failed quiz can be looked up. Errors that happen before a quiz exists (unknown lesson, invalid settings) have none. A failed quiz records why in `failure_reason`, as an error code and never model output (a database constraint requires a reason exactly when the status is `failed`): `invalid_output`, `refusal`, `truncated`, `budget_exceeded`, `timeout`, `rate_limited`, `provider_error`, `cancelled` or `internal_error`. Every `llm_calls` row made for a quiz carries the quiz id in `correlation_id`, which is what the cost endpoint sums.

With `LLM_PROVIDER=fake`, only the sample lesson in `api/fixtures/lessons/recursion.md` generates successfully, because the fake always answers with the recursion questions.

## LLM pipeline

All LLM access goes through `LlmService.generate()` in `api/src/llm`. It runs, in order:

1. **Budget guard**: sums today's (UTC) `cost_usd` in `llm_calls`; at or over `LLM_DAILY_BUDGET_USD` it fails with 429 without calling the provider.
2. **Cache**: Redis, keyed by a sha256 of feature, prompt, version, model and the variables (canonical JSON). A Redis outage only disables the cache.
3. **Prompt**: rendered from `api/prompts/<promptId>/v<n>.md`. Untrusted variables (`{{lesson | untrusted}}`) are wrapped in `<lesson>` delimiters.
4. **Provider call**: up to 3 attempts for 429, 5xx and timeouts, with exponential backoff and full jitter (`LLM_RETRY_BASE_DELAY_MS`, capped by `LLM_RETRY_MAX_DELAY_MS`). If the provider sends `Retry-After`, the next attempt waits at least that long, capped by `LLM_RETRY_AFTER_MAX_MS`. Other 4xx errors are not retried.
5. **Validation**: a refusal or a response cut off by `maxTokens` fails at once, because a repair can't fix either. Otherwise it strips code fences, parses JSON, then checks the zod schema and the optional rule checks. If anything fails, it makes **one repair call** that lists the problems.
6. **Recording**: one `llm_calls` row per call (tokens, cost, latency, status, attempts, and the caller's optional `correlation_id`), whatever the outcome.

With `LLM_PROVIDER=fake` (the default), `FakeLlmClient` answers from `api/test/fixtures/llm/<promptId>/*.txt` and never touches the network.

Prices in `api/config/llm-pricing.json` were copied from Anthropic's pricing page on the date in its `checkedOn` field. Check them before relying on the budget.

## Tests

```bash
cd api
npm test             # unit tests
npm run test:e2e     # e2e tests; needs `docker compose up -d` (uses the quizforge_test database)
npm run lint

cd web
npm test -- --watch=false
npm run lint
```

No test calls a real LLM. The e2e suite migrates the `quizforge_test` database before it runs. Unit tests hide Nest log output; run `DEBUG=1 npm test` to see it.

The exception is the opt-in live tests: a smoke test that makes one tiny real `generate()` call, and `test/quiz.live-spec.ts`, which generates one quiz per sample lesson and prints a report (schema accepted, rule violations before repair, tokens, cost, the quiz). With `claude-haiku-5-5` the whole run costs well under a cent. Put the key and model in `api/.env.live.local` (copy `api/.env.live.example`; gitignored) or in the environment, then run from `api/`:

```bash
LLM_LIVE_TESTS=1 npm run test:live                       # bash
$env:LLM_LIVE_TESTS='1'; npm run test:live               # PowerShell
```

Without `LLM_LIVE_TESTS=1` it is skipped.

## Errors

Every API error is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details response
(`Content-Type: application/problem+json`). Validation errors carry an `errors` array of
`{ pointer, detail }` entries, where `pointer` is a JSON Pointer into the request body.

LLM failures map to these statuses:

- Daily budget used up: 429, with `Retry-After` set to the seconds until UTC midnight.
- Provider rate limit: 503, with `Retry-After`.
- Provider timeout: 504.
- Model refused the request: 422.
- Model output cut off by `maxTokens`: 502, with a hint to raise it.
- Provider error or invalid model output: 502.

An invalid-output response lists the violations in `errors` but never includes the model output.
