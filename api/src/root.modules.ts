import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { type Env, validateEnv } from './config/env.schema.js';
import { buildDataSourceOptions } from './database/database.options.js';

/**
 * The root modules every entry point needs: the API (AppModule) and the
 * command-line tools (EvalCliModule). Kept in one place so both read the
 * same .env file and validate it the same way.
 */
export const rootConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  // Vitest sets NODE_ENV=test, so e2e tests read .env.test (separate database).
  envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
  validate: validateEnv,
});

export const rootDatabaseModule = TypeOrmModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => ({
    ...buildDataSourceOptions(config.get('DATABASE_URL', { infer: true })),
    // Entities come from TypeOrmModule.forFeature() in each module.
    autoLoadEntities: true,
  }),
});
