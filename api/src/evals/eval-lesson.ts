import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { assertLessonContentLength } from '../lessons/lesson-content.js';
import {
  DIFFICULTIES,
  QUESTION_TYPES,
  QUIZ_COUNT_MAX,
  QUIZ_COUNT_MIN,
  type QuizSettings,
} from '../quiz/quiz.types.js';
import { EVAL_LESSONS_DIR } from './eval-paths.js';

export interface EvalLesson {
  /** The file name without .md, e.g. "04-photosynthesis": stable across runs, so runs can be compared per lesson. */
  slug: string;
  title: string;
  content: string;
  settings: QuizSettings;
}

const frontMatterSchema = z.strictObject({
  title: z.string().min(1),
  count: z.coerce.number().int().min(QUIZ_COUNT_MIN).max(QUIZ_COUNT_MAX),
  difficulty: z.enum(DIFFICULTIES),
});

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

/**
 * Reads one eval lesson: a front matter block of `key: value` lines (title,
 * count, difficulty), then the lesson text. Only that flat subset of YAML is
 * supported, which is all these files need. Every quiz asks for both
 * question types, like the default in the web app.
 */
export function parseEvalLesson(slug: string, text: string): EvalLesson {
  const match = FRONT_MATTER.exec(text);
  if (!match) {
    throw new Error(
      `${slug}: must start with a front matter block between "---" lines`,
    );
  }
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    if (line.trim() === '') {
      continue;
    }
    const separator = line.indexOf(':');
    if (separator === -1) {
      throw new Error(
        `${slug}: front matter line "${line}" is not "key: value"`,
      );
    }
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  const parsed = frontMatterSchema.safeParse(fields);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map(
        (issue) =>
          `${issue.path.join('.') || 'front matter'}: ${issue.message}`,
      )
      .join('; ');
    throw new Error(`${slug}: invalid front matter (${problems})`);
  }
  const content = (match[2] ?? '').trim();
  // Same limits as POST /api/lessons, so every eval lesson could be a real one.
  assertLessonContentLength(content);
  return {
    slug,
    title: parsed.data.title,
    content,
    settings: {
      count: parsed.data.count,
      difficulty: parsed.data.difficulty,
      types: [...QUESTION_TYPES],
    },
  };
}

/** Every *.md file in the directory, in file-name order; --limit takes the first N. */
export function loadEvalLessons(
  dir: string = EVAL_LESSONS_DIR,
  limit?: number,
): EvalLesson[] {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .sort();
  if (files.length === 0) {
    throw new Error(`No eval lessons (*.md) in ${dir}`);
  }
  return files
    .slice(0, limit)
    .map((file) =>
      parseEvalLesson(
        file.slice(0, -'.md'.length),
        readFileSync(join(dir, file), 'utf8'),
      ),
    );
}
