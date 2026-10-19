# QuizForge

QuizForge turns a lesson into a reviewed quiz. An LLM drafts quiz questions, a teacher approves, edits, rejects or regenerates them, and an eval harness measures prompt quality.

> Status: Phase 3 (review actions and publishing). Through the API, a teacher can generate a draft quiz from a lesson, edit, approve, reject or regenerate its questions, and publish it; there is no web UI for it yet.

## Roadmap

- [x] Phase 0: Scaffold (NestJS API, Angular app, PostgreSQL and Redis via Docker Compose, config validation, problem-details errors, health check)
- [x] Phase 1: LLM foundation (LlmModule, prompt registry, daily budget, Redis cache, retries with backoff, output validation and repair, per-call cost tracking)
- [x] Phase 2: Lessons and synchronous quiz generation (lessons, quizzes and questions tables, quiz prompt v1, rule checks, sample lessons)
- [x] Phase 3: Review actions and publishing (edit, approve/reject, regenerate one question, publish, review stats, shuffled answer options)

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
| `postman/`           | OpenAPI spec, Postman collections and the local environment        |

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

All feature routes are under `/api`. Interactive docs (Swagger UI) are at http://localhost:3000/docs, and the OpenAPI spec at `/docs-json`; set `API_DOCS_ENABLED=false` to turn both off.

| Method and path                 | What it does                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `POST /api/lessons`             | `{ title, content }`. Content must be 200 to 20,000 characters (400 if shorter, 413 if longer) |
| `GET /api/lessons/:id`          | Read a lesson                                                                 |
| `POST /api/lessons/:id/quizzes` | `{ count: 3-10, difficulty: easy \| medium \| hard, types: [multiple_choice, true_false] }`. Generates the quiz synchronously and returns it with its draft questions |
| `GET /api/lessons/:id/quizzes`  | The lesson's quizzes, newest first, without questions: `{ id, status, failureReason, settings, createdAt }`. `?limit=` from 1 to 100 (default 20) |
| `GET /api/quizzes/:id`          | Read a quiz with its questions, in order. A failed quiz has a `failureReason` |
| `GET /api/quizzes/:id/cost`     | `{ quizId, calls, attempts, inputTokens, outputTokens, totalTokens, costUsd }` summed over every LLM call made for the quiz (regenerations and failed calls included) |
| `PATCH /api/questions/:id`      | `{ stem?, options?, correctIndex?, explanation?, status? }`. Edits content and/or changes the status; returns the question |
| `POST /api/questions/:id/regenerate` | Generates one replacement question of the same type at the same position (201); the old one is soft-deleted |
| `POST /api/quizzes/:id/publish` | Publishes a draft quiz with at least one approved question; returns it with only the approved questions |
| `GET /api/quizzes/:id/review-stats` | `{ quizId, total, byStatus, regenerated, editRate, rejectRate, missRate }` |

Generated questions must pass the zod output schema and the rule checks in `api/src/quiz/rules.ts`:
- distinct options;
- `correctIndex` in range;
- no "all/none of the above";
- no duplicate stems;
- every `sourceQuote` at least `QUIZ_SOURCE_QUOTE_MIN_WORDS` words long (default 5) and found in the lesson;
- the requested count and types.

If a quiz still fails after the one repair call, it is saved with status `failed` and the request returns 502. Each question keeps the model's original output in `original`.

When generation fails, the error response includes a `quizId` member, so the failed quiz can be looked up. Errors that happen before a quiz exists (unknown lesson, invalid settings) have none. A failed quiz records why in `failure_reason`, as an error code and never model output (a database constraint requires a reason exactly when the status is `failed`): `invalid_output`, `refusal`, `truncated`, `budget_exceeded`, `timeout`, `rate_limited`, `provider_error`, `cancelled` or `internal_error`. Every `llm_calls` row made for a quiz carries the quiz id in `correlation_id`, which is what the cost endpoint sums.

Before saving, each multiple-choice question's options are shuffled and `correctIndex` updated, so the answer's position carries no signal. `original` keeps the model's raw output in its own order, so position bias can be measured later.

### Reviewing a quiz

- **Status:** a question goes from `draft` to `approved` or `rejected`, and back to `draft`. Anything else (e.g. `approved` to `rejected`) is a 409. Setting the status a question already has is a no-op.
- **Edits:** the edited question must still be valid for its type (4 distinct options, or exactly `True`/`False`) and pass the rules above, except the `sourceQuote` rules, which stop applying once a human has edited a question. A failing edit returns 400 with every violation in `errors`. `editedAt` is set only when the content actually changes. An approved question stays approved after an edit.
- **Regenerate:** uses `api/prompts/quiz-regenerate/v1.md`, with the lesson, the replaced question's stem and the other questions' stems (all delimited as data), and is never cached. The replacement must quote the lesson and must not repeat any of those stems. It comes in as a `draft` with its own `original`.
- **Publish:** only a `draft` quiz with at least one approved question (422 otherwise). Nothing is deleted: a published quiz consists of its approved questions, and its questions can no longer be edited, regenerated or re-published (409).
- **Review stats:**
  - `editRate` is approved questions whose content differs from `original`, divided by approved questions. Reordering options, or changing only case or whitespace, is not an edit; changing the correct answer is.
  - `rejectRate` is rejected ÷ (approved + rejected). Drafts are undecided.
  - `missRate` is (rejected + regenerated) ÷ (approved + rejected + regenerated): how often the model's question was not good enough, whichever way the teacher discarded it.
  - A rate with nothing to divide by is `null`.

Each question records the prompt and model that wrote it (`prompt_id`, `prompt_version`, `model`), because a regenerated question comes from a different prompt than the rest of its quiz.

With `LLM_PROVIDER=fake`, only the sample lesson in `api/fixtures/lessons/recursion.md` generates successfully, because the fake always answers with the recursion questions.

## API docs and Postman

`postman/` holds:

| File | What it is |
| ---- | ---------- |
| `openapi.json` | The OpenAPI spec, exported from the code |
| `QuizForge.generated.postman_collection.json` | Every endpoint, generated from the spec. Never edit it by hand |
| `QuizForge.happy-path.postman_collection.json` | Hand-maintained: create a lesson, generate a quiz, approve a question, regenerate another, publish. Each request saves the ids the next one needs and checks its status code |
| `local.postman_environment.json` | `baseUrl` (http://localhost:3000) only; no secrets |

Every endpoint documents its success response and its errors as problem details (`application/problem+json`).

After changing an endpoint, DTO or documented error, regenerate the spec and the generated collection from `api/`:

```bash
npm run openapi:export
```

It reads the code without starting anything (no database, Redis or API key needed), and the output only changes when the API does. A unit test fails while `postman/openapi.json` is out of date.

To run the happy path with the API running (it works with `LLM_PROVIDER=fake`):

```bash
cd api
npm run postman:happy-path
# or, with only the collection files: npx newman run postman/QuizForge.happy-path.postman_collection.json -e postman/local.postman_environment.json
```

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
