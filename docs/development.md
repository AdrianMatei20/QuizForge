# Development

Running QuizForge from source, configuring it, and testing it. For the quickest start (Docker, no API key), see the [README](../README.md#run-it).

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
| `api/src/demo/`      | Demo mode (fake provider, sample lessons only) and `GET /api/info` |
| `docker-compose.yml` | Local PostgreSQL and Redis; the whole app in the `full` profile; Prometheus, Grafana, an OTel Collector and Tempo in the `observability` profile |
| `docker/`            | Container init scripts (creates the `quizforge_test` database) and the observability config, including the Grafana dashboard |
| `postman/`           | OpenAPI spec, Postman collections and the local environment        |
| `e2e/`               | One Playwright browser test of the whole flow, against the Docker stack |
| `docs/`              | These documents                                                    |
| `.github/workflows/` | CI                                                                 |

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
npm run seed                # optional: the sample lessons and a published quiz (safe to run twice)
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
2. **Generate a quiz:** open a sample lesson (after `npm run seed`) and press **Generate another quiz**, or on **New lesson** paste the text of a file in `api/fixtures/lessons/` (everything below its `# Title` line). With the fake provider only the sample lessons work; any other lesson gets a demo-mode message. The review board opens at once, and the questions appear as they are written ("Generating 3 of 5").
3. **Review board:** each question has **Approve**, **Reject**, **Edit** and **Regenerate**. Pressing Approve or Reject again moves a question back to draft. Edit opens an inline form that checks the same rules as the API. Regenerate replaces one question.
4. **Publish quiz** becomes available once a question is approved. It opens the read-only published view.

Everything works from the keyboard: fields are labelled, focus is always visible, and status changes are announced to screen readers.

## The whole app in Docker

`docker compose --profile full up -d --build` builds and starts the API and the web app next to PostgreSQL and Redis:

- **web** (http://localhost:8080): the built Angular app served by nginx as an unprivileged user, with `/api` proxied to the API (buffering off, so the quiz stream arrives live).
- **api** (http://localhost:3001, Swagger UI at `/docs`): a multi-stage image with production dependencies only, running as the unprivileged `node` user. On start it creates its database (`quizforge_demo`) if missing, runs every pending migration, seeds the demo data (`SEED_ON_START=true`; safe on every start), then starts the API. It uses Redis database 2, so it shares nothing with a local dev API (database 0) or the tests (database 1).

It runs in demo mode by default (`LLM_PROVIDER=fake`). For real quizzes, pass the provider settings from your shell; they reach the container as environment variables at run time and are never part of the image (`.dockerignore` keeps every `.env*` file out of the build):

```bash
LLM_PROVIDER=anthropic LLM_API_KEY=sk-ant-... LLM_MODEL=claude-haiku-5-5 \
  docker compose --profile full up -d
```

The ports are bound to localhost and can be changed with `WEB_PORT` and `API_PORT`. `docker compose --profile full down` stops it, together with PostgreSQL and Redis (`-v` also deletes the data volumes, including your local development database). To stop only the app, run `docker compose stop api web`.

## Configuration

All API configuration comes from environment variables, validated at startup by a zod schema in
`api/src/config/env.schema.ts`. See `api/.env.example` for every variable. If anything is invalid,
the API refuses to start and names each bad variable (never its value), for example:

```text
Error: Invalid environment configuration:
  - LLM_API_KEY: is required unless LLM_PROVIDER is "fake"
```

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

No test calls a real LLM. Before the e2e suite runs, `test/global-setup.ts` checks that PostgreSQL and Redis can be reached (and fails in one line, "Can't reach PostgreSQL at localhost:5432. Is Docker running?", when they cannot), drops the `quizforge_test` schema and runs every migration from nothing (which also proves the migrations build the schema), and empties the tests' own Redis database (1). Unit tests hide Nest log output; run `DEBUG=1 npm test` to see it.

The exception is the opt-in live tests: a smoke test that makes one tiny real `generate()` call, and `test/quiz.live-spec.ts`, which generates one quiz per sample lesson and prints a report (schema accepted, rule violations before repair, tokens, cost, the quiz). With `claude-haiku-5-5` the whole run costs well under a cent. Put the key and model in `api/.env.live.local` (copy `api/.env.live.example`; gitignored) or in the environment, then run from `api/`:

```bash
LLM_LIVE_TESTS=1 npm run test:live                       # bash
$env:LLM_LIVE_TESTS='1'; npm run test:live               # PowerShell
```

Without `LLM_LIVE_TESTS=1` it is skipped.

## CI

`.github/workflows/ci.yml` runs on every push and pull request, with no secrets (every LLM call goes to the fake provider) and npm caches per lockfile:

| Job | What it runs |
| --- | ------------ |
| API | lint, typecheck, unit tests, e2e tests (PostgreSQL and Redis service containers), production build; then fails if `npm run openapi:export` changes `postman/openapi.json` or the generated collection |
| Web | lint, unit tests, production build; then fails if `npm run api:types` changes `openapi.generated.ts` |
| Full stack | after both: `docker compose --profile full up -d --build --wait`, the Playwright test (`e2e/`: open a seeded sample lesson, generate a quiz, approve a question, publish) and the Postman happy path with Newman against the API container. On failure it uploads the Playwright report and the container logs |

To run the browser test locally against the Docker stack:

```bash
docker compose --profile full up -d --build --wait
cd e2e
npm install
npx playwright install chromium
npm test
```
