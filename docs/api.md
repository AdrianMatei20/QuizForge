# API

Every endpoint, the generation and review rules, taking a quiz, and how errors look. The live, complete reference is Swagger UI at `/docs` on a running API (http://localhost:3000/docs locally, http://localhost:3001/docs in the Docker stack).

## Endpoints

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
| `GET /api/quizzes/:id/attempt-stats` | `{ quizId, attempts, averageScore, questions: [{ questionId, position, attempts, correct, percentCorrect, flag }], thresholds }` (see [Taking a quiz](#taking-a-quiz)) |
| `GET /api/public/quizzes/:id` | A published quiz for a student: no correct answers, explanations or source quotes. 404 unless published |
| `POST /api/public/quizzes/:id/attempts` | `{ answers: [{ questionId, selectedIndex }] }`: every question exactly once. Scored on the server and stored; returns the score and, per question, whether it was correct, the correct option and the explanation (201) |
| `GET /api/usage`                | `?from=YYYY-MM-DD&to=YYYY-MM-DD` (UTC days, inclusive; default the last 7 days, at most 366). LLM usage totals plus one bucket per day and feature (see [Usage](observability.md#usage)) |
| `GET /api/evals`                | `?limit=1-200` (default 50) `&includeDryRuns=true`. Eval runs newest first, with their headline metrics; dry runs are left out by default |
| `GET /api/evals/compare`        | `?a=<run id>&b=<run id>`: every compared metric of both runs, `b - a`, and whether that is better or worse |
| `GET /api/info`                 | `{ demoMode, sampleLessons }`: whether the API runs on the fake provider (demo mode), and which sample lessons work then |
| `GET /metrics`                  | Prometheus metrics (outside `/api`, like `/health`)                            |

Starting a quiz (`POST /api/lessons/:id/quizzes`) and regenerating a question share one rate limit per client IP: `THROTTLE_GENERATE_LIMIT` requests (default 10) per `THROTTLE_GENERATE_TTL_MS` (default 60,000). Over it, they return 429 problem details (`urn:quizforge:problem:too-many-requests`) with `Retry-After`. Submitting a quiz attempt has its own limit (see [Taking a quiz](#taking-a-quiz)). Other endpoints are not limited.

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

**Demo mode.** With `LLM_PROVIDER=fake`, the fake provider answers each sample lesson in `api/fixtures/lessons/` (recursion, binary search, HTTP caching) with that lesson's own fixtures, recognised by the lesson's content hash. Generating or regenerating for any other lesson returns 422 `urn:quizforge:problem:demo-mode-lesson` ("demo mode supports the sample lessons only; set an API key to use your own", with the sample titles in `sampleLessons`) before anything is stored. `FAKE_LLM_SAMPLE_LESSONS_ONLY=false` turns that check off, which the tests do to exercise invalid model output. In demo mode, regenerating replaces a multiple-choice question; the fixtures have no true/false replacement.

### Taking a quiz

A published quiz can be taken by anyone with its link, `/q/<quiz id>` (the published view shows it, with a Copy button). There is no login and no LLM call.

- **`GET /api/public/quizzes/:id`** returns only what a student needs: the lesson title, and each approved question's id, position, type, stem and options, in order. The correct answer, the explanation and the source quote are never in it; the e2e tests check every key and string of the response. It has its own response class, so a field added to the teacher's response cannot leak into it. A quiz that is not published is a 404 with the same message as an unknown one.
- **`POST /api/public/quizzes/:id/attempts`** takes `{ answers: [{ questionId, selectedIndex }] }`. Every question must be answered exactly once with an option that exists; otherwise it returns 400 problem details with every problem located (`#/answers` for a missing answer, `#/answers/2/questionId` for a repeated or unknown question, `#/answers/1/selectedIndex` for an option out of range). The attempt is scored on the server and stored in `attempts` (each answer with whether it was correct), and the response gives the score and, per question, whether it was correct, the correct option and the explanation. It is rate limited per client IP: `THROTTLE_ATTEMPT_LIMIT` (default 20) per `THROTTLE_ATTEMPT_TTL_MS` (default 60,000), separately from the generation limit.
- **`GET /api/quizzes/:id/attempt-stats`** (for the teacher) returns the number of attempts, the average score (0 to 1) and, per question, the attempts, correct answers, share correct and a flag: `too_easy` above `ATTEMPT_FLAG_TOO_EASY_ABOVE` (default 0.9), `possibly_wrong` below `ATTEMPT_FLAG_POSSIBLY_WRONG_BELOW` (default 0.2). A question is only flagged from `ATTEMPT_FLAG_MIN_ATTEMPTS` attempts (default 5): with one attempt, every question is either 0% or 100%. The percentages are shown before that, with their attempt counts.

## API docs and Postman

`postman/` holds:

| File | What it is |
| ---- | ---------- |
| `openapi.json` | The OpenAPI spec, exported from the code |
| `QuizForge.generated.postman_collection.json` | Every endpoint, generated from the spec. Never edit it by hand |
| `QuizForge.happy-path.postman_collection.json` | Hand-maintained: create a lesson, generate a quiz, approve a question, regenerate another, publish, take the quiz as a student (read it, submit an attempt), read the attempt stats, then generate a streamed quiz and watch its stream. Each request saves the ids the next one needs and checks its status code and response |
| `local.postman_environment.json` | `baseUrl` (http://localhost:3000) only; no secrets. Use `--env-var baseUrl=http://localhost:3001` for the Docker stack |

Every endpoint documents its success response and its errors as problem details (`application/problem+json`).

After changing an endpoint, DTO or documented error, regenerate the spec and the generated collection from `api/`:

```bash
npm run openapi:export
```

It reads the code without starting anything (no database, Redis or API key needed), and the output only changes when the API does. A unit test fails while `postman/openapi.json` is out of date.

To run the happy path with the API running (it works with `LLM_PROVIDER=fake`; CI runs it against the Docker stack):

```bash
cd api
npm run postman:happy-path
# or, with only the collection files: npx newman run postman/QuizForge.happy-path.postman_collection.json -e postman/local.postman_environment.json
```

## Errors

Every API error is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details response
(`Content-Type: application/problem+json`). Validation errors carry an `errors` array of
`{ pointer, detail }` entries for request body fields, where `pointer` is a JSON Pointer such as
`#/options/3`, and `{ parameter, detail }` entries for query and path parameters, e.g.
`{ "parameter": "limit", ... }` or `{ "parameter": "id", "detail": "id must be a UUID" }`.

LLM failures map to these statuses:

- Daily budget used up: 429, with `Retry-After` set to the seconds until UTC midnight.
- Generation or attempt rate limit exceeded (not an LLM failure, but the same status): 429 `too-many-requests`, with `Retry-After`. Behind a proxy, set `TRUST_PROXY_HOPS` so the limit counts each client, not the proxy.
- Provider rate limit: 503, with `Retry-After`.
- Provider timeout: 504.
- Model refused the request: 422.
- Demo mode, a lesson that is not a sample lesson: 422 `demo-mode-lesson`, before any quiz is created.
- Model output cut off by `maxTokens`: 502, with a hint to raise it.
- Provider error or invalid model output: 502.

An invalid-output response lists the violations in `errors` but never includes the model output.
