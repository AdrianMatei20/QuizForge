// Entry point for the TypeORM CLI only (see the migration:* npm scripts and
// test/global-setup.ts). The Nest app builds its connection in AppModule instead.
import { extname, join } from 'node:path';
import { DataSource } from 'typeorm';
import { baseEnvSchema, parseEnv } from '../config/env.schema.js';
import { buildDataSourceOptions } from './database.options.js';

try {
  // Variables already set in the real environment take precedence over the file.
  process.loadEnvFile('.env');
} catch {
  // No .env file (e.g. in a deployed environment): use the real environment only.
}

const env = parseEnv(baseEnvSchema.pick({ DATABASE_URL: true }), process.env);

// ".ts" when run from source (via tsx), ".js" when run from dist.
// Matching the exact extension keeps the globs from picking up .d.ts files.
const ext = extname(import.meta.filename);

export default new DataSource({
  ...buildDataSourceOptions(env.DATABASE_URL),
  entities: [join(import.meta.dirname, '..', '**', `*.entity${ext}`)],
  migrations: [join(import.meta.dirname, 'migrations', `*${ext}`)],
});
