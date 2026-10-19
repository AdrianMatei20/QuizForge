import { ProblemException } from '../common/problem-details/problem-details.js';
import {
  assertLessonContentLength,
  lessonContentLength,
} from './lesson-content.js';

function problemFor(content: string) {
  try {
    assertLessonContentLength(content);
  } catch (error) {
    return (error as ProblemException).problem;
  }
  return undefined;
}

describe('lessonContentLength', () => {
  it('counts code points of the trimmed text, so an emoji counts once', () => {
    expect(lessonContentLength('  ab\u{1F600}  ')).toBe(3);
    expect('ab\u{1F600}'.length).toBe(4); // what String.length would say
  });
});

describe('assertLessonContentLength', () => {
  it.each([200, 20_000])('accepts %d characters', (length) => {
    expect(problemFor('a'.repeat(length))).toBeUndefined();
  });

  it('rejects 199 characters with a 400 pointing at content', () => {
    expect(problemFor('a'.repeat(199))).toMatchObject({
      status: 400,
      errors: [
        {
          pointer: '#/content',
          detail: expect.stringContaining('at least 200'),
        },
      ],
    });
  });

  it('does not count surrounding whitespace toward the minimum', () => {
    expect(problemFor(`   ${'a'.repeat(199)}   `)?.status).toBe(400);
  });

  it('rejects 20,001 characters with a 413 problem', () => {
    expect(problemFor('a'.repeat(20_001))).toMatchObject({
      type: 'urn:quizforge:problem:lesson-too-large',
      status: 413,
      maxLength: 20_000,
    });
  });

  it('counts 20,000 emoji as 20,000 characters, not 40,000', () => {
    expect(problemFor('\u{1F600}'.repeat(20_000))).toBeUndefined();
  });
});
