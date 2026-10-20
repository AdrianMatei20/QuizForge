import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { SEED_MODEL, seedDemoData } from '../src/database/seed-demo.js';
import { Lesson } from '../src/lessons/lesson.entity.js';
import { loadSampleLessons } from '../src/lessons/sample-lessons.js';
import { Question } from '../src/quiz/question.entity.js';
import { Quiz } from '../src/quiz/quiz.entity.js';

/**
 * The demo seed against the real test database. Other suites may already
 * have created sample lessons there, so this checks the guarantees rather
 * than exact first-run counts: every sample exists, the oldest recursion
 * lesson has a published quiz, and a second run changes nothing.
 */
describe('Demo seed (e2e)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    moduleRef.useLogger(false);
    await moduleRef.init();
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  const counts = async () => ({
    lessons: await dataSource.getRepository(Lesson).count(),
    quizzes: await dataSource.getRepository(Quiz).count(),
    questions: await dataSource.getRepository(Question).count(),
  });

  it('adds every sample lesson and a published recursion quiz, and is safe to run twice', async () => {
    await seedDemoData(dataSource);
    const afterFirst = await counts();

    const second = await seedDemoData(dataSource);

    expect(second).toEqual({ lessonsCreated: 0, publishedQuizCreated: false });
    expect(await counts()).toEqual(afterFirst);

    const lessons = dataSource.getRepository(Lesson);
    for (const sample of loadSampleLessons()) {
      expect(await lessons.existsBy({ contentHash: sample.contentHash })).toBe(
        true,
      );
    }
    const recursion = loadSampleLessons().find(
      (sample) => sample.name === 'recursion',
    );
    const oldest = await lessons.findOneOrFail({
      where: { contentHash: recursion?.contentHash ?? '' },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const published = await dataSource.getRepository(Quiz).findOneOrFail({
      where: { lessonId: oldest.id, status: 'published' },
      relations: { questions: true },
    });
    expect(published.questions?.length).toBeGreaterThan(0);
    // When the seed made it (no other suite published one for this lesson first):
    if (published.model === SEED_MODEL) {
      expect(published.questions?.every((q) => q.status === 'approved')).toBe(
        true,
      );
      expect(published.questions?.every((q) => q.model === SEED_MODEL)).toBe(
        true,
      );
    }
  });
});
