# FakeLlmClient fixtures

`<promptId>/default.txt` is what `FakeLlmClient` returns for a prompt unless a test queues something else.
Other files are used with `fake.respondWithFixture('<name>')`.

## quiz

One fixture per sample lesson in `api/fixtures/lessons/` (5 questions each, both types); every `sourceQuote`
is copied from that lesson, which `src/quiz/sample-fixtures.spec.ts` checks.

- `default.txt` is a copy of `recursion.txt`, so with `LLM_PROVIDER=fake` only the recursion sample lesson
  generates successfully. Other lessons fail the source-quote rule (a known limitation of the fake).
- `fabricated-quote.txt` is `recursion.txt` with question 2's `sourceQuote` replaced by a sentence that is not
  in the lesson, to exercise the repair call.
