import type { DataSourceOptions } from 'typeorm';

type PostgresOptions = Extract<DataSourceOptions, { type: 'postgres' }>;

/**
 * Connection settings shared by the Nest app and the TypeORM CLI. Each adds
 * its own way of finding entities:
 * - the app uses autoLoadEntities (modules register theirs with forFeature);
 * - the CLI uses file globs (see data-source.ts), because it needs every
 *   entity and migration and runs under tsx, which can import .ts files.
 */
export function buildDataSourceOptions(databaseUrl: string): PostgresOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    // Schema changes only happen through reviewed migrations, never at startup.
    synchronize: false,
    migrationsRun: false,
    // uuid columns default to gen_random_uuid(), built into PostgreSQL 13+,
    // and TypeORM never installs extensions behind our back.
    uuidExtension: 'pgcrypto',
    installExtensions: false,
  };
}
