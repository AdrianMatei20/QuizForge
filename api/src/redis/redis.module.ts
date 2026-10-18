import {
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.schema.js';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * A refused connection can arrive as an AggregateError (one attempt per
 * resolved address) with an empty message, so fall back to its code.
 */
export function describeRedisError(error: NodeJS.ErrnoException): string {
  return error.message || error.code || error.name;
}

@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Redis => {
        const logger = new Logger('Redis');
        const client = new Redis(config.get('REDIS_URL', { infer: true }));
        // Without a listener, ioredis reports every reconnect failure as an unhandled error.
        client.on('error', (error: NodeJS.ErrnoException) =>
          logger.warn(`Connection error: ${describeRedisError(error)}`),
        );
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'ready') {
      await this.redis.quit();
    } else {
      this.redis.disconnect();
    }
  }
}
