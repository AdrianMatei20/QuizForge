# QuizForge

QuizForge turns a lesson into a reviewed quiz. An LLM drafts quiz questions, a teacher approves, edits, rejects or regenerates them, and an eval harness measures prompt quality.

> Status: Phase 8 (eval harness). In the browser, a teacher finds earlier lessons and their quizzes, writes a lesson and watches the quiz's questions appear one by one as the model writes them, then reviews every question (approve, reject, edit, regenerate) and publishes it. LLM calls, tokens and cost are visible on a /usage page, in Prometheus and Grafana, and as OpenTelemetry traces. An eval harness measures the quality of the quiz prompt's questions, with a second model as judge, and compares prompt versions.

## Roadmap

- [x] Phase 0: Scaffold (NestJS API, Angular app, PostgreSQL and Redis via Docker Compose, config validation, problem-details errors, health check)
- [x] Phase 1: LLM foundation (LlmModule, prompt registry, daily budget, Redis cache, retries with backoff, output validation and repair, per-call cost tracking)
- [x] Phase 2: Lessons and synchronous quiz generation (lessons, quizzes and questions tables, quiz prompt v1, rule checks, sample lessons)
- [x] Phase 3: Review actions and publishing (edit, approve/reject, regenerate one question, publish, review stats, shuffled answer options)
- [x] Phase 4: Angular lesson editor and review board (lesson form, review board with optimistic status changes and inline editing, published view, typed API client, problem-details error handling)
- [x] Phase 5: Streaming with JSON Lines over SSE (questions validated and saved as they arrive, one repair step for gaps, replay on reconnect, stuck-quiz cleanup, live review board)
- [x] Phase 6: Metrics, tracing and usage (Prometheus metrics, OpenTelemetry traces, `GET /api/usage` and a /usage page, estimated usage for aborted streams, rate limiting on generation, a Prometheus, Grafana and Tempo stack in Docker Compose)
- [x] Phase 7: Lesson and quiz history (`GET /api/lessons` with quiz counts by status, question counts in a lesson's quiz list, a lessons list and a lesson page in the web app)
- [x] Phase 8: Eval harness (10 eval lessons, `npm run eval` with metrics and an LLM judge, Markdown and JSON reports, `eval_runs`, run comparison, a human-agreement check, the provider effort setting, quiz prompt v2, an /evals page)

## Repository layout

| Path                 | What it is                                                         |
| -------------------- | ------------------------------------------------------------------ |
| `api/`               | NestJS API (TypeScript, TypeORM + PostgreSQL, Redis)               |
| `api/src/llm/`       | LlmModule: the only way the API talks to an LLM                    |
| `api/prompts/`       | Prompt files, `<promptId>/v<n>.md`                                 |
| `api/config/`        | `llm-pricing.json`: USD per million tokens, per model              |
| `api/src/lessons/`   | Lessons: create, read and list                                     |
| `api/src/quiz/`      | Quizzes: generation, output schema, rule checks                    |
| `api/src/metrics/`   | Prometheus metrics for LLM calls, served at `GET /metrics`         |
| `api/src/usage/`     | `GET /api/usage`: LLM usage per day and feature                    |
| `api/src/telemetry.ts` | OpenTelemetry setup, loaded before the app when tracing is on    |
| `api/src/evals/`     | The eval harness: runner, metrics, judge, reports, comparison, command-line tools |
| `api/evals/`         | Eval lessons (`lessons/`), committed reports (`results/`) and human-labelled samples (`samples/`) |
| `api/fixtures/`      | Sample lessons (recursion, binary search, HTTP caching)            |
| `web/`               | Angular app (standalone components, signals, Signal Forms)         |
| `web/src/app/core/`  | Typed API client (types generated from the OpenAPI spec), errors   |
| `docker-compose.yml` | Local PostgreSQL and Redis; Prometheus, Grafana, an OTel Collector and Tempo in the `observability` profile |
| `docker/`            | Container init scripts (creates the `quizforge_test` database) and the observability config, including the Grafana dashboard |
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

### Try it in the browser

With the API on `LLM_PROVIDER=fake` (the default in `.env.example`), open http://localhost:4200:

1. **Lessons:** the home page lists every lesson, newest first, with its quizzes counted by status. Open one to see its text, its quizzes, and **Generate another quiz**.
2. **New lesson:** paste the text of `api/fixtures/lessons/recursion.md` (everything below its `# Recursion` title line; the fake provider only answers for this lesson), give it a title, keep the default settings (5 questions), and press **Generate quiz**. The review board opens at once, and the questions appear as they are written ("Generating 3 of 5").
3. **Review board:** each question has **Approve**, **Reject**, **Edit** and **Regenerate**. Pressing Approve or Reject again moves a question back to draft. Edit opens an inline form that checks the same rules as the API. Regenerate replaces one question.
4. **Publish quiz** becomes available once a question is approved. It opens the read-only published view.

Everything works from the keyboard: fields are labelled, focus is always visible, and status changes are announced to screen readers.

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
| `GET /api/lessons`              | `?limit=1-100` (default 20) `&offset=` (default 0). Lessons newest first, without their content: `{ items: [{ id, title, createdAt, quizCounts: { generating, draft, published, failed } }], total, limit, offset }` |
| `GET /api/lessons/:id`          | Read a lesson                                                                 |
| `POST /api/lessons/:id/quizzes` | `{ count: 3-10, difficulty: easy \| medium \| hard, types: [multiple_choice, true_false], stream? }`. Without `stream`: generates synchronously and returns the quiz (201). With `stream: true`: returns 202 `{ quizId }` at once and generates in the background |
| `GET /api/quizzes/:id/stream`   | Server-Sent Events while the quiz is generated: `question`, `question_rejected`, `done`, `problem` (see below) |
| `GET /api/lessons/:id/quizzes`  | The lesson's quizzes, newest first, without questions: `{ id, status, failureReason, settings, createdAt, questionCount }`. `questionCount` is the approved questions of a published quiz, otherwise all current ones; replaced questions never count. `?limit=` from 1 to 100 (default 20) |
| `GET /api/quizzes/:id`          | Read a quiz with its questions, in order. A failed quiz has a `failureReason` |
| `GET /api/quizzes/:id/cost`     | `{ quizId, calls, attempts, inputTokens, outputTokens, totalTokens, costUsd }` summed over every LLM call made for the quiz (regenerations and failed calls included) |
| `PATCH /api/questions/:id`      | `{ stem?, options?, correctIndex?, explanation?, status? }`. Edits content and/or changes the status; returns the question |
| `POST /api/questions/:id/regenerate` | Generates one replacement question of the same type at the same position (201); the old one is soft-deleted |
| `POST /api/quizzes/:id/publish` | Publishes a draft quiz with at least one approved question; returns it with only the approved questions |
| `GET /api/quizzes/:id/review-stats` | `{ quizId, total, byStatus, regenerated, editRate, rejectRate, missRate }` |
| `GET /api/usage`                | `?from=YYYY-MM-DD&to=YYYY-MM-DD` (UTC days, inclusive; default the last 7 days, at most 366). LLM usage totals plus one bucket per day and feature (see [Usage](#usage)) |
| `GET /api/evals`                | `?limit=1-200` (default 50) `&includeDryRuns=true`. Eval runs newest first, with their headline metrics; dry runs are left out by default |
| `GET /api/evals/compare`        | `?a=<run id>&b=<run id>`: every compared metric of both runs, `b - a`, and whether that is better or worse |
| `GET /metrics`                  | Prometheus metrics (outside `/api`, like `/health`)                            |

Starting a quiz (`POST /api/lessons/:id/quizzes`) and regenerating a question share one rate limit per client IP: `THROTTLE_GENERATE_LIMIT` requests (default 10) per `THROTTLE_GENERATE_TTL_MS` (default 60,000). Over it, they return 429 problem details (`urn:quizforge:problem:too-many-requests`) with `Retry-After`. Other endpoints are not limited.

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

### Streaming a quiz

With `stream: true`, the quiz is created as `generating` and the model writes JSON Lines (`api/prompts/quiz-stream/v1.md`): one question object per line. Each line is checked as soon as it is complete, with the same schema and per-question rules as above, plus a duplicate-stem check against the questions already saved and the requested count:

- a valid line is saved (options shuffled) and sent as a `question` event;
- an invalid one is sent as `question_rejected` with `{ position, violations }`.

After the stream ends, **one repair step** regenerates each missing position (rejected, or never written) with the regenerate prompt, and sends those questions too. The quiz then becomes a `draft` with whatever was saved, even if a position could not be filled, and the stream sends `done` with `{ generated, rejected, usage }`. Only a quiz with no questions at all becomes `failed`, with a `problem` event.

Generation runs once per quiz, in the background:

- **Reconnecting:** a client that connects later, or reconnects after a page refresh, first gets every saved question again, then the live events, or straight away `done` or `problem`.
- **Disconnecting** never stops generation.
- **Timeouts:** the whole run is limited by `QUIZ_GENERATION_TIMEOUT_MS`. If it times out with nothing saved, the quiz fails with reason `timeout`.
- **Cleanup:** quizzes left `generating` by a crash or restart are cleaned up at startup and every `QUIZ_STUCK_SWEEP_INTERVAL_MS`. They become a `draft` if they have questions; otherwise they fail with reason `interrupted`.

Streamed calls go through `LlmService.stream()`, with the same budget guard and the same `llm_calls` recording as any other call. To watch a stream from a terminal:

```bash
# Start a streamed quiz for a lesson, then follow its events (-N: don't buffer).
curl -s -X POST http://localhost:3000/api/lessons/<lessonId>/quizzes \
  -H 'Content-Type: application/json' \
  -d '{"count": 5, "difficulty": "medium", "types": ["multiple_choice", "true_false"], "stream": true}'
curl -N http://localhost:3000/api/quizzes/<quizId>/stream
```

### Reviewing a quiz

- **Status:** a question goes from `draft` to `approved` or `rejected`, and back to `draft`. Anything else (e.g. `approved` to `rejected`) is a 409. Setting the status a question already has is a no-op.
- **Edits:** the edited question must still be valid for its type (4 distinct options, or exactly `True`/`False`) and pass the rules above, except the `sourceQuote` rules, which stop applying once a human has edited a question. A failing edit returns 400 with every violation in `errors`, each pointing at the field to fix (e.g. `#/options/3` for a repeated option, `#/stem` for a duplicate stem). `editedAt` is set only when the content actually changes. An approved question stays approved after an edit.
- **`isEdited`:** each question in a response says whether its content now differs from the AI's version, by the same rule as the edit rate (reordering options or changing only case or whitespace does not count). The AI's original itself stays internal.
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

**Aborted streams.** A stream that fails or is stopped part-way often ends before the provider reports its usage, yet the tokens were still billed. In that case the `llm_calls` row is estimated and marked `usage_estimated = true`: input tokens come from the provider's `message_start` event when it arrived, otherwise from the prompt length (about 4 characters per token); output tokens come from the text received so far, by the same rule. Estimated cost counts towards the daily budget, and `/api/usage` reports it separately.

## Usage

`GET /api/usage` sums `llm_calls` by UTC day and feature. The response has `totals` and a `days` array (sorted by day, then feature), and every bucket has the same shape:

- `calls`, `inputTokens`, `outputTokens`, `costUsd` (a decimal string, summed exactly);
- `cacheHitRate` and `errorRate` (calls whose status is not `ok`), or `null` with no calls;
- `byStatus`: a count for each status (`ok`, `invalid_output`, `error`, `budget_exceeded`, `refused`, `truncated`), zeros included;
- `estimated`: the calls, tokens and cost that were estimated (see Aborted streams above), already included in the main figures.

An invalid range (bad date, `from` after `to`, more than 366 days) returns 400 with a `{ parameter, detail }` entry.

## Observability

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

## Evals

The eval harness measures how good the quiz prompt's questions are, so a prompt change is judged by numbers rather than by a few examples. It lives in `api/src/evals/`.

```bash
cd api
npm run eval -- --prompt v2 --judge-model claude-sonnet-5-5   # all 10 lessons, about $0.25
npm run eval -- --prompt v1 --limit 2                         # the first 2 lessons only
npm run eval -- --prompt v1 --dry-run                         # fake provider: free, checks the pipeline only
npm run eval:compare -- <runA> <runB>                         # run ids, or unique prefixes of 6+ characters
npm run eval:sample -- <run>                                  # 20 judged questions to a CSV for you to label
npm run eval:agreement -- evals/samples/<run>-sample.csv      # how often you agreed with the judge
```

Options of `npm run eval`: `--prompt v<n>` (required), `--model` (default `LLM_MODEL`), `--judge-model` (default `LLM_JUDGE_MODEL`), `--effort low|medium|high` (the provider's effort setting for generation; default the provider's), `--limit N`, `--dry-run`.

**What a run does.** It runs as a standalone Nest application context (no HTTP server, and not `AppModule`, whose stuck-quiz sweep could interfere with a running API):

1. Loads the lessons in `api/evals/lessons/*.md`. Each has front matter with `title`, `count` and `difficulty`; every quiz asks for both question types. Three are the sample lessons; replace any of them with your own.
2. Generates one quiz per lesson with the chosen prompt version, through `LlmService`, exactly as production does (same schema, rules and repair step), with the cache off. Up to 4 calls run at once.
3. Judges every final question with `api/prompts/judge/v1.md`. The judge sees the lesson and the question with its marked answer (not the explanation or `sourceQuote`, so it has to find support in the lesson itself) and returns `{ answerCorrect, answerableFromLesson, testsUnderstanding, reason }`. Judge calls keep the cache on, so an unchanged question is never paid for twice.
4. Writes `api/evals/results/<time>-v<n>.md` (summary, one row per lesson, the 10 weakest questions with the judge's reasons) and the same data as `.json`, and saves an `eval_runs` row with the numbers (no question text).

Every LLM call is recorded in `llm_calls` as usual, with features `eval-quiz-generation` and `eval-judge` (so `/usage` keeps eval spend apart) and correlation ids `<run id>/gen/<lesson>` and `<run id>/judge/<lesson>`, from which each lesson's cost is read back, failed calls and repairs included. Eval spend counts towards `LLM_DAILY_BUDGET_USD`; if the budget runs out, the remaining lessons fail with `budget_exceeded` and the report says the run is incomplete.

With `LLM_PROVIDER=fake`, `npm run eval` refuses to run unless `--dry-run` is given: the fake answers every lesson with the recursion quiz, so its numbers would look real and mean nothing. `--dry-run` forces the fake provider through the environment (which wins over `.env`), so it can never spend money; its reports go to the gitignored `api/evals/results/dry-run/`, start with a warning, and are hidden on the /evals page unless you tick Show dry runs.

**Metrics.** Lesson-level rates count lessons; the others count questions.

| Metric | What it measures | Over |
| ------ | ---------------- | ---- |
| Schema-valid | The first answer matched the JSON schema | Lessons with a first answer |
| Rule-pass before repair | The first answer passed the schema and every quiz rule | Lessons with a first answer |
| Repair rate | The repair call was needed | Lessons with a first answer |
| sourceQuote found | The quote appears in the lesson | First-answer questions (after repair it is 100% by the rules) |
| Duplicate stems | The stem repeats an earlier one in the quiz | First-answer questions |
| Quote copy | The stem shares 6 or more consecutive words with its own quote | Final questions |
| Shared quote | The quote overlaps another question's quote in the quiz (6+ shared words, or contained) | Final questions |
| Questions dropped | Requested minus saved in the final quiz | |
| Judge rates | answerCorrect, answerableFromLesson, testsUnderstanding | Judged questions |
| Tokens, cost, latency | Generation and judging, separately; cost summed exactly | |

The first-answer numbers come from an `onValidation` callback on `LlmGenerateRequest`, which reports each validation (the first answer and the repair) to the caller, with the parsed data but never the raw model text.

**Results so far** (`claude-haiku-5-5`, provider-default effort, judged by `claude-sonnet-5-5`, 10 lessons and 57 questions per run; reports in `api/evals/results/`):

| | v1, run 1 | v1, run 2 | v2, run 1 | v2, run 2 |
| --- | --- | --- | --- | --- |
| Quote copy | 28.1% | 22.8% | 3.5% | 0% |
| Judge: tests understanding | 24.6% | 22.8% | 59.6% | 61.4% |
| Judge: answer correct | 100% | 98.2% | 94.7% | 96.5% |
| Shared quote | 3.5% | 3.5% | 10.5% | 3.5% |
| Generation output tokens | 21,447 | 21,842 | 25,885 | 25,622 |
| Total cost | $0.2422 | $0.2390 | $0.2552 | $0.2573 |

Every run passed the schema and the rules on the first answer. Between repeats of the same prompt, the judge rates moved by 1.8 points (one question in 57) and quote copy by up to 5.3 points; v2's changes are far larger: quote copy down by about 24 points and tests understanding up by about 37. The price is about 19% more output tokens and slightly more wrong answer keys (2 to 3 in 57 instead of 0 to 1), which is worth watching: questions that apply an idea are harder to key correctly than recall questions.

**Prompt v2** (`api/prompts/quiz/v2.md`) is v1 with one change, aimed at the two weakest numbers above: stems must be written in the model's own words instead of copying the source quote, and medium and hard questions must apply an idea to a new case instead of recalling a sentence. The app still uses v1; switching is a one-line change to `QUIZ_PROMPT`, left to a later phase.

**Checking the judge.** An LLM judge is a measuring instrument and needs checking too. `npm run eval:sample -- <run>` writes 20 random judged questions to `api/evals/samples/<run id>-sample.csv` (UTF-8 with a byte-order mark, so Excel opens it correctly); fill in `my_verdict` with pass or fail for each. `npm run eval:agreement -- <file>` then reports percent agreement, the 2×2 table, Cohen's kappa (agreement corrected for chance, which matters when most questions pass) and every disagreement with the judge's reason. It reads files saved with `,` or `;` (Excel uses `;` in locales with a decimal comma). The judge passes a question only when all three checks pass.

**Effort.** `--effort` sets the provider's effort for quiz generation (Anthropic's `output_config.effort`), so runs at different levels can be compared on quality and cost. It is recorded in `llm_calls.effort` and `eval_runs.effort`, and is part of the LLM cache key.

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

## Web app

`web/` is an Angular app (standalone components, signals for state, Signal Forms, plain SCSS):

| Route | What it is |
| ----- | ---------- |
| `/` | Lessons, newest first, 20 per page (`?offset=` in the URL), with quiz counts by status and a New lesson button |
| `/lessons/new` | Lesson editor with live character counters at the API's limits, and the quiz settings |
| `/lessons/:id` | A lesson: its text (collapsed), its quizzes newest first, and Generate another quiz |
| `/quizzes/:id/review` | Review board: one card per question, counts and edit rate in the header, Publish |
| `/quizzes/:id/published` | The published quiz, read-only |
| `/usage` | LLM usage for a date range (default the last 7 UTC days): cost, calls, tokens, cache-hit and error rates, counts by status, and a daily cost-by-feature chart with a data table view |
| `/evals` | Eval runs, newest first, with their headline metrics (dry runs hidden unless Show dry runs is ticked); select two and Compare |
| `/evals/compare?a=&b=` | Two runs side by side: every metric, the change from A (the older run, the baseline) to B, and a worded verdict (better, worse, same) |

- **Lesson page:** each quiz shows a status badge (with its name, not only a colour), its questions against the requested count ("4 of 5 questions"), its settings and date. Draft and generating quizzes link to the review board, where a generating quiz picks up its live stream; published ones link to the published view; a failed one says why in a sentence ("Failed because the AI service took too long."), never as a code. Generate another quiz uses the same settings fields as the lesson editor (`QuizSettingsFields`, with one shared validation schema) and opens the new quiz's review board.
- **API client:** `LessonsApi`, `QuizzesApi` and `QuestionsApi` use types generated from `postman/openapi.json`. After an API change, run `npm run openapi:export` in `api/`, then `npm run api:types` in `web/`.
- **State:** the review board's state lives in signals in `QuizReviewStore`. Approve and reject are optimistic: the card changes at once and rolls back with an error if the API refuses.
- **Streaming:** Generate uses stream mode and opens the review board straight away. `QuizzesApi.stream()` wraps `EventSource` in an Observable that completes on `done`, errors on `problem` (the message is shown), and closes when the page is destroyed. If the connection drops, `EventSource` reconnects by itself, and the server replays what was missed. While generating, approve, reject and edit work on the questions that have arrived; Regenerate and Publish wait until generation is done.
- **Errors:** an HTTP interceptor turns every error response into a typed `AppError`, and the UI shows a sentence a teacher can act on, never raw JSON. Unusable model output (502) offers Try again; a used-up daily budget (429) says so, and so does the generation rate limit (429).
- **Charts:** the usage chart is plain SVG, without a chart library. Each feature keeps its colour whatever else is shown, and the chart has a text summary for screen readers and a table of the same numbers.
- **Model output is always text.** `npm run lint` fails on `[innerHTML]` or `[outerHTML]` bindings and on any `bypassSecurityTrust*` call.

## Errors

Every API error is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details response
(`Content-Type: application/problem+json`). Validation errors carry an `errors` array of
`{ pointer, detail }` entries for request body fields, where `pointer` is a JSON Pointer such as
`#/options/3`, and `{ parameter, detail }` entries for query and path parameters, e.g.
`{ "parameter": "limit", ... }` or `{ "parameter": "id", "detail": "id must be a UUID" }`.

LLM failures map to these statuses:

- Daily budget used up: 429, with `Retry-After` set to the seconds until UTC midnight.
- Generation rate limit exceeded (not an LLM failure, but the same status): 429 `too-many-requests`, with `Retry-After`.
- Provider rate limit: 503, with `Retry-After`.
- Provider timeout: 504.
- Model refused the request: 422.
- Model output cut off by `maxTokens`: 502, with a hint to raise it.
- Provider error or invalid model output: 502.

An invalid-output response lists the violations in `errors` but never includes the model output.

## Design decisions

- **OpenTelemetry directly, not `@nestjs/observe`.** `@nestjs/observe` (0.3.13 when evaluated in October 2026) is an agent for a hosted service, NestJS Observe, which needs an account, an app key and secret, and sends data in its own format rather than OTLP. It is also pre-1.0 and was releasing several times a week. The OpenTelemetry SDK is vendor-neutral: the same OTLP export works with the local Collector and Tempo here, or any other backend.
- **A Nest tracing interceptor instead of the Nest auto-instrumentation.** `@opentelemetry/instrumentation-nestjs-core` does not support `@nestjs/core` 12 yet, so `TracingInterceptor` (`api/src/common/tracing/`) makes the span for each controller handler. HTTP and PostgreSQL still use the official instrumentations. When the official one supports Nest 12, the interceptor can go.
- **Metrics and the span are recorded in `LlmService`**, next to the `llm_calls` row, so the database, Prometheus and the trace always agree, and a new feature gets them without any extra code.
- **The eval harness calls the production pipeline, not a copy of it.** It sends `buildQuizRequest()` through `LlmService`, so it measures the same schema, rules and repair step a teacher gets. To see the first answer before repair, `LlmService` gained an `onValidation` callback; returning that information in the result instead would lose it whenever the call fails.
- **The judge does not see the explanation or the source quote**, only the lesson and the question with its marked answer, so it checks the answer against the lesson rather than against the generator's own justification.
- **Eval runs keep their questions in files, and only numbers in the database.** `eval_runs.metrics` (jsonb) is enough for the list and the comparison; the Markdown and JSON reports, committed to the repository, are what a reviewer reads.
- **The rate limit is one counter per IP across both endpoints.** `@nestjs/throttler` counts each handler separately by default, which would allow 10 quizzes and 10 regenerations a minute. Both cost LLM calls, so they share one budget.

## Known limitations

- **`/metrics` is not authenticated.** Anyone who can reach the API can read it. The figures are counts, latencies, tokens and cost, with no lesson content, but in production it should be reachable only from the Prometheus network (or behind auth at the proxy).
- **Rate-limit counts are in memory, per instance.** With several API instances, each one counts on its own, so a client gets the limit once per instance. `@nestjs/throttler` supports a Redis storage, which would make the limit shared.

- **One API instance for live streaming.** Live stream events are kept in the memory of the process that runs the generation. With several API instances behind a load balancer, a client connected to another instance would still get the replay of saved questions and the final `done` or `problem`, but not the live events in between. Fanning them out through Redis pub/sub (Redis is already part of the stack) would remove that limit.
- **The fake provider only knows the recursion lesson.** With `LLM_PROVIDER=fake`, other lessons fail the source-quote rule, because the fake always answers with the recursion questions. An eval dry run therefore fails 9 of its 10 lessons.
- **Eval numbers come from 10 lessons.** One question is about 1.8 percentage points of a judge rate, and one lesson is 10 points of a lesson-level rate, so repeat a run before trusting a small difference. The judge is one model's opinion; `eval:agreement` measures how far it can be trusted.
