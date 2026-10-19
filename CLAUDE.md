# QuizForge

QuizForge turns a lesson into a reviewed quiz. An LLM drafts quiz questions, a teacher approves, edits, rejects or regenerates them, and an eval harness measures prompt quality.

Readable code, tests and clearly reasoned design decisions matter more than feature count.

## Stack
- api/: NestJS 12 (ESM), TypeScript strict mode, TypeORM with migrations (never synchronize), PostgreSQL, Redis via ioredis, Vitest and Supertest, oxlint and Prettier
- web/: Angular (current stable), standalone components, signals for state, HttpClient, plain SCSS, no UI component library, Vitest, angular-eslint
- docker-compose.yml at the repo root for local infrastructure
- LLM provider: Anthropic, through its official Node SDK. Model IDs always come from config, never from code.

## Commands
Keep this section accurate whenever scripts change.

Infrastructure (repo root):
- `docker compose up -d`: start PostgreSQL and Redis (a fresh volume also creates the `quizforge_test` database)
- `docker compose down`: stop them (add `-v` to delete the data volumes)

api/ (run from `api/`; copy `.env.example` to `.env` first):
- `npm run start:dev`: run the API on http://localhost:3000 in watch mode
- `npm run build` / `npm run start:prod`: compile to `dist/` / run the compiled app
- `npm test`: unit tests (`src/**/*.spec.ts`); the Nest logger is silenced, set `DEBUG=1` to see it
- `npm run test:e2e`: e2e tests (`test/**/*.e2e-spec.ts`); needs docker compose running, reads `.env.test`, migrates the test database first
- `LLM_LIVE_TESTS=1 npm run test:live`: live tests against the real provider (`test/**/*.live-spec.ts`, costs money): a smoke test, and one quiz per sample lesson with a printed report. Reads `LLM_API_KEY` and `LLM_MODEL` from the environment, then `.env.live.local` (see `.env.live.example`), then `.env`; skipped without the flag. Add a path (e.g. `test/quiz.live-spec.ts`) to run one file
- `npm run lint`: oxlint with type-aware rules (src, test, scripts)
- `npm run typecheck`: `tsc --noEmit` over src, test and scripts
- `npm run format`: Prettier
- `npm run openapi:export`: build, then write `postman/openapi.json` and regenerate `postman/QuizForge.generated.postman_collection.json` from it. Run after changing any endpoint, DTO or documented error; `src/docs/openapi.spec.ts` fails until you do
- `npm run postman:happy-path`: run `postman/QuizForge.happy-path.postman_collection.json` with newman against a running API (`postman/local.postman_environment.json`, http://localhost:3000; override with `-- --env-var baseUrl=...`)
- `npm run migration:generate -- src/database/migrations/<Name>`: generate a migration from entity changes
- `npm run migration:create -- src/database/migrations/<Name>`: create an empty migration
- `npm run migration:run` / `npm run migration:revert` / `npm run migration:show`: apply, undo the last, list

web/ (run from `web/`):
- `npm start`: dev server on http://localhost:4200; proxies `/api` to the API
- `npm test -- --watch=false`: unit tests, single run
- `npm run lint`: angular-eslint (`ng lint`) over TypeScript and templates
- `npm run build`: production build to `dist/web`
- `npm run format`: Prettier

## Architecture rules
- All LLM access goes through LlmModule in api/src/llm. No other module imports a provider SDK.
- LLM output schemas are zod schemas. HTTP DTOs use class-validator.
- LLM output is never trusted until it passes its zod schema AND its rule checks.
- Prompts are files in api/prompts/<promptId>/v<n>.md. Every stored LLM result records prompt_id, prompt_version and model.
- Untrusted text (lessons, user input) is always wrapped in delimiters, and the system prompt says it is data, not instructions.
- Money is stored as numeric/decimal, never as a float.
- All errors are RFC 9457 problem details, produced by one global exception filter.
- Config uses @nestjs/config with a zod-validated schema; the app refuses to start on invalid config.
- Never log or return API keys, raw prompts with lesson content, or raw model output in error responses.
- In Angular, model output is rendered as text. Never use innerHTML or bypassSecurityTrust* for it.

## Testing rules
- Unit and e2e tests use FakeLlmClient. No test calls a real LLM unless LLM_LIVE_TESTS=1.
- Pure logic (rule checks, parsers, metric math) gets focused unit tests with passing and failing cases.
- Every bug fix gets a test that would have caught it.
- Run lint and all tests before reporting a task as done.

## Working rules
- For any change touching more than two files, present a plan first and wait for my approval.
- Stay inside the current phase. Put anything out of scope under "Follow-ups" in your summary instead of doing it.
- Prefer simple, explicit code over clever abstractions.
- End every task with: what changed, how to verify it, decisions made and why, and follow-ups.