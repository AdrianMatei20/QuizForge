import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { Lesson } from '../lessons/lesson.entity.js';
import { loadSampleLessons } from '../lessons/sample-lessons.js';
import { DEFAULT_FIXTURES_DIR } from '../llm/fake-llm.client.js';
import { Question } from '../quiz/question.entity.js';
import { newQuestionRow } from '../quiz/question-row.js';
import { quizOutputSchema } from '../quiz/quiz-output.schema.js';
import { Quiz } from '../quiz/quiz.entity.js';
import { QUIZ_PROMPT } from '../quiz/quiz-request.js';

/** Recorded as the model of seeded rows: no LLM wrote them in this database. */
export const SEED_MODEL = 'seed-fixture';
/** The lesson that gets a published quiz. */
const PUBLISHED_SAMPLE = 'recursion';
// Any fixed number keeps the shuffled option order the same on every run.
const FIXED_RANDOM = () => 0.5;
// pg_advisory_xact_lock key: two seeds starting at once (e.g. two API
// containers) run one after the other instead of both inserting.
const SEED_LOCK = 4_242_001;

export interface SeedResult {
  lessonsCreated: number;
  publishedQuizCreated: boolean;
}

/**
 * Demo data for a first start: the sample lessons, and one published quiz
 * for the recursion lesson made from its fake-provider fixture (no LLM call,
 * every question approved). Safe to run any number of times: a lesson is
 * only added when no lesson has its content hash, and the quiz only when
 * that lesson has no published quiz yet. One transaction, so a failure
 * leaves nothing half-seeded.
 */
export async function seedDemoData(
  dataSource: DataSource,
): Promise<SeedResult> {
  return dataSource.transaction(async (manager) => {
    await manager.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK]);
    const lessons = manager.getRepository(Lesson);
    const result: SeedResult = {
      lessonsCreated: 0,
      publishedQuizCreated: false,
    };

    let publishedSample: Lesson | null = null;
    for (const sample of loadSampleLessons()) {
      // The oldest one, so every run picks the same lesson when there are several.
      let lesson = await lessons.findOne({
        where: { contentHash: sample.contentHash },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      if (!lesson) {
        lesson = await lessons.save(
          lessons.create({
            title: sample.title,
            content: sample.content,
            contentHash: sample.contentHash,
          }),
        );
        result.lessonsCreated++;
      }
      if (sample.name === PUBLISHED_SAMPLE) {
        publishedSample = lesson;
      }
    }
    if (!publishedSample) {
      throw new Error(`The ${PUBLISHED_SAMPLE} sample lesson is missing`);
    }

    const quizzes = manager.getRepository(Quiz);
    if (
      await quizzes.existsBy({
        lessonId: publishedSample.id,
        status: 'published',
      })
    ) {
      return result;
    }
    const generated = quizOutputSchema.parse(
      JSON.parse(
        readFileSync(
          join(DEFAULT_FIXTURES_DIR, 'quiz', `${PUBLISHED_SAMPLE}.txt`),
          'utf8',
        ),
      ),
    );
    const quiz = await quizzes.save(
      quizzes.create({
        lessonId: publishedSample.id,
        status: 'published',
        failureReason: null,
        promptId: QUIZ_PROMPT.id,
        promptVersion: QUIZ_PROMPT.version,
        model: SEED_MODEL,
        settings: {
          count: generated.questions.length,
          difficulty: 'easy',
          types: ['multiple_choice', 'true_false'],
        },
      }),
    );
    const questions = manager.getRepository(Question);
    await questions.save(
      generated.questions.map((question, index) =>
        questions.create({
          ...newQuestionRow({
            quizId: quiz.id,
            position: index + 1,
            generated: question,
            prompt: QUIZ_PROMPT,
            model: SEED_MODEL,
            random: FIXED_RANDOM,
          }),
          status: 'approved',
        }),
      ),
    );
    result.publishedQuizCreated = true;
    return result;
  });
}
