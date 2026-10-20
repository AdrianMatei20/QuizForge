# LLM pipeline

How every LLM call is made, checked and recorded.

## The steps

All LLM access goes through `LlmService.generate()` in `api/src/llm`. It runs, in order:

1. **Budget guard**: sums today's (UTC) `cost_usd` in `llm_calls`; at or over `LLM_DAILY_BUDGET_USD` it fails with 429 without calling the provider.
2. **Cache**: Redis, keyed by a sha256 of feature, prompt, version, model and the variables (canonical JSON). A Redis outage only disables the cache.
3. **Prompt**: rendered from `api/prompts/<promptId>/v<n>.md`. Untrusted variables (`{{lesson | untrusted}}`) are wrapped in `<lesson>` delimiters.
4. **Provider call**: up to 3 attempts for 429, 5xx and timeouts, with exponential backoff and full jitter (`LLM_RETRY_BASE_DELAY_MS`, capped by `LLM_RETRY_MAX_DELAY_MS`). If the provider sends `Retry-After`, the next attempt waits at least that long, capped by `LLM_RETRY_AFTER_MAX_MS`. Other 4xx errors are not retried.
5. **Validation**: a refusal or a response cut off by `maxTokens` fails at once, because a repair can't fix either. Otherwise it strips code fences, parses JSON, then checks the zod schema and the optional rule checks. If anything fails, it makes **one repair call** that lists the problems.
6. **Recording**: one `llm_calls` row per call (tokens, cost, latency, status, attempts, and the caller's optional `correlation_id`), whatever the outcome.

With `LLM_PROVIDER=fake` (the default), `FakeLlmClient` answers from `api/test/fixtures/llm/<promptId>/*.txt` and never touches the network: with `<promptId>/<sample>.txt` when the prompt's `<lesson>` is a sample lesson (by content hash) and that fixture exists, otherwise with `<promptId>/default.txt`. Tests can queue other answers (failures, specific text, other fixtures) for the next calls.

Prices in `api/config/llm-pricing.json` were copied from Anthropic's pricing page on the date in its `checkedOn` field. Check them before relying on the budget.

**Aborted streams.** A stream that fails or is stopped part-way often ends before the provider reports its usage, yet the tokens were still billed. In that case the `llm_calls` row is estimated and marked `usage_estimated = true`: input tokens come from the provider's `message_start` event when it arrived, otherwise from the prompt length (about 4 characters per token); output tokens come from the text received so far, by the same rule. Estimated cost counts towards the daily budget, and `/api/usage` reports it separately.
