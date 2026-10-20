# Evals

The eval harness: how prompt quality is measured, and the results so far.

## Running an eval

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

With `LLM_PROVIDER=fake`, `npm run eval` refuses to run unless `--dry-run` is given: the fake answers with canned quizzes (only the sample lessons have their own), so its numbers would look real and mean nothing. `--dry-run` forces the fake provider through the environment (which wins over `.env`), so it can never spend money; its reports go to the gitignored `api/evals/results/dry-run/`, start with a warning, and are hidden on the /evals page unless you tick Show dry runs.

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
