import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lessonContentHash } from './lesson-content.js';

/** api/fixtures/lessons, from both src/lessons and dist/lessons. */
export const SAMPLE_LESSONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  'fixtures',
  'lessons',
);

export interface SampleLesson {
  /** The file name without .md, e.g. "binary-search"; also the name of its fake LLM fixtures. */
  name: string;
  title: string;
  /** Trimmed, as a lesson is stored. */
  content: string;
  contentHash: string;
}

/** A sample lesson file: a "# Title" line, then the content. */
export function parseSampleLesson(name: string, text: string): SampleLesson {
  const [heading = '', ...rest] = text.split(/\r?\n/);
  if (!heading.startsWith('# ')) {
    throw new Error(`Sample lesson ${name} must start with a "# Title" line`);
  }
  const content = rest.join('\n').trim();
  return {
    name,
    title: heading.slice(2).trim(),
    content,
    contentHash: lessonContentHash(content),
  };
}

/** Every sample lesson, in file-name order. */
export function loadSampleLessons(
  dir: string = SAMPLE_LESSONS_DIR,
): SampleLesson[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) =>
      parseSampleLesson(
        file.slice(0, -'.md'.length),
        readFileSync(join(dir, file), 'utf8'),
      ),
    );
}
