import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * Runs once before the e2e suite: brings the quizforge_test database up to
 * the latest migration with the same CLI command developers use. (TypeORM
 * loads migration files with a plain import(), which cannot read TypeScript
 * inside Vitest, so this runs it in a child process under tsx.)
 */
export default function setup(): void {
  const { DATABASE_URL } = parseEnv(readFileSync('.env.test', 'utf8'));
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is missing from .env.test');
  }
  execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      './node_modules/typeorm/cli.js',
      'migration:run',
      '-d',
      './src/database/data-source.ts',
    ],
    // DATABASE_URL in the environment wins over any .env file.
    { env: { ...process.env, DATABASE_URL }, stdio: 'pipe' },
  );
}
