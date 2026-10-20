import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseSampleLesson,
  SAMPLE_LESSONS_DIR,
} from '../../src/lessons/sample-lessons.js';

export const SAMPLE_LESSONS = [
  'recursion',
  'binary-search',
  'http-caching',
] as const;
export type SampleLessonName = (typeof SAMPLE_LESSONS)[number];

/** Reads api/fixtures/lessons/<name>.md: a "# Title" line, then the content. */
export function loadSampleLesson(name: SampleLessonName): {
  title: string;
  content: string;
} {
  const { title, content } = parseSampleLesson(
    name,
    readFileSync(join(SAMPLE_LESSONS_DIR, `${name}.md`), 'utf8'),
  );
  return { title, content };
}
