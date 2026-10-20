# Roadmap

How QuizForge was built, phase by phase, and what would come next.

## Phases

- [x] Phase 0: Scaffold (NestJS API, Angular app, PostgreSQL and Redis via Docker Compose, config validation, problem-details errors, health check)
- [x] Phase 1: LLM foundation (LlmModule, prompt registry, daily budget, Redis cache, retries with backoff, output validation and repair, per-call cost tracking)
- [x] Phase 2: Lessons and synchronous quiz generation (lessons, quizzes and questions tables, quiz prompt v1, rule checks, sample lessons)
- [x] Phase 3: Review actions and publishing (edit, approve/reject, regenerate one question, publish, review stats, shuffled answer options)
- [x] Phase 4: Angular lesson editor and review board (lesson form, review board with optimistic status changes and inline editing, published view, typed API client, problem-details error handling)
- [x] Phase 5: Streaming with JSON Lines over SSE (questions validated and saved as they arrive, one repair step for gaps, replay on reconnect, stuck-quiz cleanup, live review board)
- [x] Phase 6: Metrics, tracing and usage (Prometheus metrics, OpenTelemetry traces, `GET /api/usage` and a /usage page, estimated usage for aborted streams, rate limiting on generation, a Prometheus, Grafana and Tempo stack in Docker Compose)
- [x] Phase 7: Lesson and quiz history (`GET /api/lessons` with quiz counts by status, question counts in a lesson's quiz list, a lessons list and a lesson page in the web app)
- [x] Phase 8: Eval harness (10 eval lessons, `npm run eval` with metrics and an LLM judge, Markdown and JSON reports, `eval_runs`, run comparison, a human-agreement check, the provider effort setting, quiz prompt v2, an /evals page)
- [x] Phase 9: Take-quiz page and attempts (a public quiz without answers, server-side scoring, stored attempts, attempt stats with flags, a /q/:id page, results on the published view)
- [x] Phase 10: Docker demo, CI, Swagger and README (multi-stage images, a `full` Compose profile with demo mode and seed data, GitHub Actions with a browser test, a complete Swagger description, these docs)

## What I'd do next

- **Accounts.** Teachers and students are anonymous today. Sign-in, or at least per-student quiz links, would tie attempts to people, stop skewed stats, and let a student see their own history.
- **Switch the app to quiz prompt v2** after a larger eval: it is much better at testing understanding, but keyed slightly more answers wrongly (see [Evals](evals.md)). The judge's agreement with a human (`eval:agreement`) should be measured first.
- **Run more than one API instance**: Redis pub/sub for the live stream events and a Redis store for the rate limits, both of which are in memory per instance now.
- **A hard budget cap**: reserve an estimated cost before each call instead of checking the day's spend, so concurrent calls cannot overshoot.
- **Compare effort levels in the eval** (`--effort low|medium|high`) for cost against quality. Output tokens are most of the generation cost (about 2,600 per quiz in the latest run), and effort is the provider setting meant to trade them against quality.
- **Protect `/metrics`** and the teacher endpoints once there are accounts.
