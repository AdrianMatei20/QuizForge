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
import {
  quizOutputSchema,
  regeneratedQuestionSchema,
} from './quiz-output.schema.js';
import { quizRules, regeneratedQuestionRules } from './rules.js';

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

describe('quiz-regenerate fixtures', () => {
  const readFixture = (name: string) =>
    readFileSync(
      join(DEFAULT_FIXTURES_DIR, 'quiz-regenerate', `${name}.txt`),
      'utf8',
    );
  const recursionQuiz = quizOutputSchema.parse(
    JSON.parse(
      readFileSync(join(DEFAULT_FIXTURES_DIR, 'quiz', 'recursion.txt'), 'utf8'),
    ),
  );
  // Replacing question 1 of the recursion fixture, as the e2e tests do.
  const rules = regeneratedQuestionRules({
    lessonContent: loadSampleLesson('recursion').content,
    settings: {
      count: 5,
      difficulty: 'medium',
      types: ['multiple_choice', 'true_false'],
    },
    minQuoteWords: 5,
    type: 'multiple_choice',
    replacedStem: recursionQuiz.questions[0]?.stem ?? '',
    others: recursionQuiz.questions
      .slice(1)
      .map((question, index) => ({ position: index + 2, stem: question.stem })),
  });

  it('default.txt is a valid, new replacement for question 1', () => {
    const { question } = regeneratedQuestionSchema.parse(
      JSON.parse(readFixture('default')),
    );

    expect(rules(question)).toEqual([]);
  });

  it('repeated-stem.txt breaks only the "stem is new" rule, by repeating question 4', () => {
    const { question } = regeneratedQuestionSchema.parse(
      JSON.parse(readFixture('repeated-stem')),
    );

    expect(rules(question)).toEqual([
      'question: stem is the same as question 4, which is already in the quiz',
    ]);
  });
});

/**
 * Demo mode: with LLM_PROVIDER=fake, each sample lesson is answered with its
 * own fixtures (FakeLlmClient picks them by the lesson's content hash), so
 * every flow works for every sample lesson.
 */
describe('per-lesson demo fixtures', () => {
  const read = (promptId: string, name: string) =>
    readFileSync(join(DEFAULT_FIXTURES_DIR, promptId, `${name}.txt`), 'utf8');
  const settings = {
    count: 5,
    difficulty: 'medium' as const,
    types: ['multiple_choice' as const, 'true_false' as const],
  };

  it.each(SAMPLE_LESSONS)(
    '%s: the stream fixture is the quiz fixture, one question per line',
    (name) => {
      const quiz = quizOutputSchema.parse(JSON.parse(read('quiz', name)));
      const stream = name === 'recursion' ? 'default' : name;
      const lines = read('quiz-stream', stream).trim().split('\n');

      expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual(
        quiz.questions,
      );
    },
  );

  it.each(SAMPLE_LESSONS)(
    '%s: the regenerate fixture is a valid, new replacement for the first multiple-choice question',
    (name) => {
      const quiz = quizOutputSchema.parse(JSON.parse(read('quiz', name)));
      const replaced = quiz.questions.findIndex(
        (question) => question.type === 'multiple_choice',
      );
      const rules = regeneratedQuestionRules({
        lessonContent: loadSampleLesson(name).content,
        settings,
        minQuoteWords: 5,
        type: 'multiple_choice',
        replacedStem: quiz.questions[replaced]?.stem ?? '',
        others: quiz.questions
          .map((question, index) => ({
            position: index + 1,
            stem: question.stem,
          }))
          .filter((_, index) => index !== replaced),
      });
      const fixture = name === 'recursion' ? 'default' : name;
      const { question } = regeneratedQuestionSchema.parse(
        JSON.parse(read('quiz-regenerate', fixture)),
      );

      expect(rules(question)).toEqual([]);
    },
  );
});
