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

## quiz-regenerate

Replacements for question 1 of the recursion fixture, which `src/quiz/sample-fixtures.spec.ts` checks against the
regenerate rules.

- `default.txt` is a new multiple-choice question about the call stack, with a quote from the recursion lesson.
- `repeated-stem.txt` repeats question 4's stem, to exercise the repair call for the "stem is new" rule.

## quiz-stream

JSON Lines answers to the streaming prompt (`api/prompts/quiz-stream/v1.md`): one question per line.

- `default.txt` is the five recursion questions, one per line.
- `with-invalid-line.txt` is the same questions wrapped in code fences, with a blank line, no final newline, and
  line 3's `sourceQuote` replaced by a sentence that is not in the lesson. It exercises the parser, the rejection of
  one line, and the repair step (which uses `quiz-regenerate/default.txt`).
