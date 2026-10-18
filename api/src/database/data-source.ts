// Entry point for the TypeORM CLI only (see the migration:* npm scripts).
// The Nest app builds its connection in AppModule instead.
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

export default new DataSource(buildDataSourceOptions(env.DATABASE_URL));
