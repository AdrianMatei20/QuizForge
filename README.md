# QuizForge

QuizForge turns a lesson into a reviewed quiz. An LLM drafts quiz questions, a teacher approves, edits, rejects or regenerates them, and an eval harness measures prompt quality.

> Status: Phase 0 (scaffold). There are no features yet.

## Repository layout

| Path                 | What it is                                                         |
| -------------------- | ------------------------------------------------------------------ |
| `api/`               | NestJS API (TypeScript, TypeORM + PostgreSQL, Redis)               |
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

No test calls a real LLM.

## Errors

Every API error is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details response
(`Content-Type: application/problem+json`). Validation errors carry an `errors` array of
`{ pointer, detail }` entries, where `pointer` is a JSON Pointer into the request body.
