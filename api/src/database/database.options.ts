import { extname, join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';

// ".ts" when run from source (TypeORM CLI via tsx, tests), ".js" when run from dist.
// Matching the exact extension keeps the globs from picking up .d.ts files.
const ext = extname(import.meta.filename);

/** Shared by the Nest app and the TypeORM CLI, so both see the same entities and migrations. */
export function buildDataSourceOptions(databaseUrl: string): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    entities: [join(import.meta.dirname, '..', '**', `*.entity${ext}`)],
    migrations: [join(import.meta.dirname, 'migrations', `*${ext}`)],
    // Schema changes only happen through reviewed migrations, never at startup.
    synchronize: false,
    migrationsRun: false,
  };
}
