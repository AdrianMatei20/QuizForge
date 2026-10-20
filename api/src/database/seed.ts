/**
 * npm run seed (and the API container's entrypoint, with SEED_ON_START=true):
 * loads the sample lessons and one published quiz, so the demo has data on
 * first start. Safe to run twice (see seedDemoData). Uses the same
 * DATABASE_URL as the migrations: the environment, then api/.env.
 */
import dataSource from './data-source.js';
import { seedDemoData } from './seed-demo.js';

await dataSource.initialize();
try {
  const result = await seedDemoData(dataSource);
  console.log(
    `Seed: ${result.lessonsCreated} sample lesson(s) added; ` +
      (result.publishedQuizCreated
        ? 'published quiz for Recursion added.'
        : 'Recursion already has a published quiz.'),
  );
} finally {
  await dataSource.destroy();
}
