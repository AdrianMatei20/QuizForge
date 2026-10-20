import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { canonicalJson } from './canonical-json.js';
import type { PromptVariables } from './prompt-registry.js';

/** Stores validated generation results. Implementations may throw; LlmService treats that as a miss. */
export interface LlmCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export const LLM_CACHE = Symbol('LLM_CACHE');

export interface CacheKeyParts {
  feature: string;
  promptId: string;
  promptVersion: number;
  model: string;
  variables: PromptVariables;
  /** Left out when unset, so keys made before effort existed stay valid. */
  effort?: string;
}

/**
 * sha256 of the canonical JSON of everything that determines the output.
 * Hashing one JSON document (rather than joining strings with a separator)
 * means no combination of values can collide by accident, and canonical key
 * order means { a, b } and { b, a } hit the same entry.
 */
export function buildCacheKey(parts: CacheKeyParts): string {
  return createHash('sha256').update(canonicalJson(parts)).digest('hex');
}

const KEY_PREFIX = 'llm:cache:';
// ioredis queues commands while it reconnects, so a Redis outage would
// otherwise stall every generation. A cache that slow is treated as down.
const COMMAND_TIMEOUT_MS = 250;

@Injectable()
export class RedisLlmCache implements LlmCache {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  get(key: string): Promise<string | null> {
    return withTimeout(this.redis.get(KEY_PREFIX + key));
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await withTimeout(
      this.redis.set(KEY_PREFIX + key, value, 'EX', ttlSeconds),
    );
  }
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`Redis did not answer within ${COMMAND_TIMEOUT_MS}ms`),
        ),
      COMMAND_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
