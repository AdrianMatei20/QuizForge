import { HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  PROBLEM_TYPES,
  ProblemException,
} from '../common/problem-details/problem-details.js';

/** sha256 (hex) of the content as stored: trimmed. Sample lessons are recognised by it. */
export function lessonContentHash(content: string): string {
  return createHash('sha256').update(content.trim()).digest('hex');
}

export const LESSON_CONTENT_MIN = 200;
export const LESSON_CONTENT_MAX = 20_000;

/**
 * Length in Unicode code points of the trimmed text. String.length counts
 * UTF-16 units, so a single emoji would count as 2. (Grapheme clusters, via
 * Intl.Segmenter, would match what a reader sees even more closely, e.g. a
 * family emoji made of several code points; code points are a simpler,
 * predictable rule and good enough for a size limit.)
 */
export function lessonContentLength(content: string): number {
  // Splitting into code points is the point here, not an accident.
  // oxlint-disable-next-line typescript/no-misused-spread
  return [...content.trim()].length;
}

/**
 * Too short is a validation error (400). Too long is 413 Content Too Large:
 * the request is well-formed but bigger than we accept. class-validator's
 * @MaxLength would always produce a 400, so the check lives here instead.
 */
export function assertLessonContentLength(content: string): void {
  const length = lessonContentLength(content);
  if (length > LESSON_CONTENT_MAX) {
    throw new ProblemException({
      type: 'urn:quizforge:problem:lesson-too-large',
      title: 'Lesson too large',
      status: HttpStatus.PAYLOAD_TOO_LARGE,
      detail: `Lesson content must be at most ${LESSON_CONTENT_MAX} characters; this one has ${length}.`,
      maxLength: LESSON_CONTENT_MAX,
    });
  }
  if (length < LESSON_CONTENT_MIN) {
    throw new ProblemException({
      type: PROBLEM_TYPES.validation,
      title: 'Validation failed',
      status: HttpStatus.BAD_REQUEST,
      detail: 'The request contains invalid fields.',
      errors: [
        {
          pointer: '#/content',
          detail: `content must be at least ${LESSON_CONTENT_MIN} characters (got ${length})`,
        },
      ],
    });
  }
}
