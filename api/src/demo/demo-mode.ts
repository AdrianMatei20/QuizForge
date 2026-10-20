import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ProblemConvertible,
  ProblemResponse,
} from '../common/problem-details/problem-details.js';
import type { Env } from '../config/env.schema.js';
import { lessonContentHash } from '../lessons/lesson-content.js';
import {
  loadSampleLessons,
  type SampleLesson,
} from '../lessons/sample-lessons.js';

export const DEMO_MODE_LESSON_PROBLEM =
  'urn:quizforge:problem:demo-mode-lesson';

/** A lesson the fake provider has no answers for; maps to 422 problem details. */
export class DemoModeLessonError extends Error implements ProblemConvertible {
  override readonly name = 'DemoModeLessonError';

  constructor(readonly sampleTitles: string[]) {
    super('Demo mode supports the sample lessons only');
  }

  toProblem(): ProblemResponse {
    return {
      problem: {
        type: DEMO_MODE_LESSON_PROBLEM,
        title: 'Not available in demo mode',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        detail:
          'demo mode supports the sample lessons only; set an API key to use your own',
        sampleLessons: this.sampleTitles,
      },
    };
  }
}

/**
 * Demo mode: LLM_PROVIDER=fake with FAKE_LLM_SAMPLE_LESSONS_ONLY (the
 * default). The fake provider only has answers for the sample lessons in
 * api/fixtures/lessons, so generating from any other lesson is refused with
 * a clear 422 before anything is stored or called, instead of failing later
 * as invalid model output (502). Tests turn the restriction off to exercise
 * exactly those failures.
 */
@Injectable()
export class DemoMode {
  readonly enabled: boolean;
  readonly sampleLessons: readonly SampleLesson[];
  private readonly sampleHashes: ReadonlySet<string>;

  constructor(config: ConfigService<Env, true>) {
    this.enabled =
      config.get('LLM_PROVIDER', { infer: true }) === 'fake' &&
      config.get('FAKE_LLM_SAMPLE_LESSONS_ONLY', { infer: true });
    this.sampleLessons = loadSampleLessons();
    this.sampleHashes = new Set(
      this.sampleLessons.map((lesson) => lesson.contentHash),
    );
  }

  /** Throws DemoModeLessonError (422) in demo mode for a lesson that is not a sample. */
  assertSupported(lessonContent: string): void {
    if (
      this.enabled &&
      !this.sampleHashes.has(lessonContentHash(lessonContent))
    ) {
      throw new DemoModeLessonError(
        this.sampleLessons.map((lesson) => lesson.title),
      );
    }
  }
}
