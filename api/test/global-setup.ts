import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { parseEnv } from 'node:util';
import { Redis } from 'ioredis';
import pg from 'pg';

const CONNECT_TIMEOUT_MS = 3_000;

/** Resolves when something accepts TCP connections at the URL's host and port. */
function canConnect(url: URL, defaultPort: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({
      host: url.hostname,
      port: Number(url.port || defaultPort),
    });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function assertReachable(
  name: string,
  url: URL,
  defaultPort: number,
): Promise<void> {
  if (!(await canConnect(url, defaultPort))) {
    throw new Error(
      `Can't reach ${name} at ${url.hostname}:${url.port || defaultPort}. ` +
        'Is Docker running? Start it, then run `docker compose up -d` from the repo root.',
    );
  }
}

/**
 * Runs once before the e2e suite:
 * 1. fails fast, with one clear line, when PostgreSQL or Redis is down;
 * 2. resets the quizforge_test database (drop the schema, then run every
 *    migration with the same CLI command developers use), which also proves
 *    the migrations build the schema from nothing;
 * 3. empties the tests' own Redis database (see REDIS_URL in .env.test), so
 *    no cached LLM answer survives from an earlier run.
 * (TypeORM loads migration files with a plain import(), which cannot read
 * TypeScript inside Vitest, so the migrations run in a child process under tsx.)
 */
export default async function setup(): Promise<void> {
  const { DATABASE_URL, REDIS_URL } = parseEnv(
    readFileSync('.env.test', 'utf8'),
  );
  if (!DATABASE_URL || !REDIS_URL) {
    throw new Error('DATABASE_URL and REDIS_URL must be set in .env.test');
  }
  await assertReachable('PostgreSQL', new URL(DATABASE_URL), 5432);
  await assertReachable('Redis', new URL(REDIS_URL), 6379);

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
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

  const redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  await redis.connect();
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}
