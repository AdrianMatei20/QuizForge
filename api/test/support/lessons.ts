import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SAMPLE_LESSONS = [
  'recursion',
  'binary-search',
  'http-caching',
] as const;
export type SampleLessonName = (typeof SAMPLE_LESSONS)[number];

const LESSONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  'fixtures',
  'lessons',
);

/** Reads api/fixtures/lessons/<name>.md: a "# Title" line, then the content. */
export function loadSampleLesson(name: SampleLessonName): {
  title: string;
  content: string;
} {
  const text = readFileSync(join(LESSONS_DIR, `${name}.md`), 'utf8');
  const [heading = '', ...rest] = text.split(/\r?\n/);
  if (!heading.startsWith('# ')) {
    throw new Error(`Sample lesson ${name} must start with a "# Title" line`);
  }
  return { title: heading.slice(2).trim(), content: rest.join('\n').trim() };
}
