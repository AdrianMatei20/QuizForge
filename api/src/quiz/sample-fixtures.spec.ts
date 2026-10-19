import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadSampleLesson,
  SAMPLE_LESSONS,
} from '../../test/support/lessons.js';
import { DEFAULT_FIXTURES_DIR } from '../llm/fake-llm.client.js';
import {
  lessonContentLength,
  LESSON_CONTENT_MAX,
  LESSON_CONTENT_MIN,
} from '../lessons/lesson-content.js';
import { quizOutputSchema } from './quiz-output.schema.js';
import { quizRules } from './rules.js';

/** Keeps the sample lessons and their fake LLM answers consistent with each other. */
describe('sample lessons and their quiz fixtures', () => {
  const readFixture = (name: string) =>
    readFileSync(join(DEFAULT_FIXTURES_DIR, 'quiz', `${name}.txt`), 'utf8');

  it.each(SAMPLE_LESSONS)('%s: the lesson has a valid length', (name) => {
    const length = lessonContentLength(loadSampleLesson(name).content);

    expect(length).toBeGreaterThanOrEqual(LESSON_CONTENT_MIN);
    expect(length).toBeLessThanOrEqual(LESSON_CONTENT_MAX);
  });

  it.each(SAMPLE_LESSONS)(
    '%s: the fixture passes the schema and every rule',
    (name) => {
      const quiz = quizOutputSchema.parse(JSON.parse(readFixture(name)));
      const rules = quizRules({
        lessonContent: loadSampleLesson(name).content,
        minQuoteWords: 5,
        settings: {
          count: 5,
          difficulty: 'medium',
          types: ['multiple_choice', 'true_false'],
        },
      });

      expect(rules(quiz)).toEqual([]);
    },
  );

  it('default.txt is the recursion fixture', () => {
    expect(readFixture('default')).toBe(readFixture('recursion'));
  });

  it('fabricated-quote.txt breaks only the source-quote rule, on question 2', () => {
    const quiz = quizOutputSchema.parse(
      JSON.parse(readFixture('fabricated-quote')),
    );
    const rules = quizRules({
      lessonContent: loadSampleLesson('recursion').content,
      minQuoteWords: 5,
      settings: {
        count: 5,
        difficulty: 'medium',
        types: ['multiple_choice', 'true_false'],
      },
    });

    expect(rules(quiz)).toEqual([
      'question 2: sourceQuote does not appear in the lesson',
    ]);
  });
});
