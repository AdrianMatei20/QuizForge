# Web app

The Angular app's pages and how it is built.

## Pages

`web/` is an Angular app (standalone components, signals for state, Signal Forms, plain SCSS):

| Route | What it is |
| ----- | ---------- |
| `/` | Lessons, newest first, 20 per page (`?offset=` in the URL), with quiz counts by status and a New lesson button |
| `/lessons/new` | Lesson editor with live character counters at the API's limits, and the quiz settings |
| `/lessons/:id` | A lesson: its text (collapsed), its quizzes newest first, and Generate another quiz |
| `/quizzes/:id/review` | Review board: one card per question, counts and edit rate in the header, Publish |
| `/quizzes/:id/published` | The published quiz, read-only, with the student link (and a Copy button), the number of attempts and average score, and each question's percent correct with its flag |
| `/q/:id` | For students, without the teacher's navigation: one question at a time with a progress bar, Back and Next, Submit once every question is answered, then the score and, per question, the verdict, the correct answer and the explanation |
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
