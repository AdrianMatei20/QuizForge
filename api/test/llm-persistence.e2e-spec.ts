import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { Repository } from 'typeorm';
import { type Env, validateEnv } from '../src/config/env.schema.js';
import { buildDataSourceOptions } from '../src/database/database.options.js';
import { RedisLlmCache } from '../src/llm/llm-cache.js';
import { LLM_CALL_STATUSES, LlmCall } from '../src/llm/llm-call.entity.js';
import {
  type LlmCallRecord,
  TypeOrmLlmCallStore,
} from '../src/llm/llm-call.store.js';
import { RedisModule } from '../src/redis/redis.module.js';

/** Real Postgres (quizforge_test, migrated by global-setup.ts) and real Redis. */
describe('LLM persistence (e2e)', () => {
  let moduleRef: INestApplicationContext;
  let store: TypeOrmLlmCallStore;
  let calls: Repository<LlmCall>;
  let cache: RedisLlmCache;

  const row = (overrides: Partial<LlmCallRecord> = {}): LlmCallRecord => ({
    feature: 'e2e-feature',
    promptId: 'e2e-prompt',
    promptVersion: 1,
    model: 'fake-model',
    inputTokens: 10,
    outputTokens: 20,
    costUsd: '0.000100',
    latencyMs: 5,
    status: 'ok',
    cacheHit: false,
    attempts: 1,
    errorCode: null,
    correlationId: null,
    ...overrides,
  });

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
          validate: validateEnv,
        }),
        TypeOrmModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService<Env, true>) => ({
            ...buildDataSourceOptions(
              config.get('DATABASE_URL', { infer: true }),
            ),
            autoLoadEntities: true,
          }),
        }),
        TypeOrmModule.forFeature([LlmCall]),
        RedisModule,
      ],
      providers: [TypeOrmLlmCallStore, RedisLlmCache],
    }).compile();
    moduleRef = testingModule;
    store = moduleRef.get(TypeOrmLlmCallStore);
    calls = moduleRef.get(getRepositoryToken(LlmCall));
    cache = moduleRef.get(RedisLlmCache);
    await moduleRef.init();
  });

  beforeEach(async () => {
    await calls.clear();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  describe('TypeOrmLlmCallStore', () => {
    it('records a row with every column', async () => {
      await store.record(
        row({ status: 'error', errorCode: 'timeout', attempts: 3 }),
      );

      const [saved] = await calls.find();
      expect(saved).toMatchObject({
        feature: 'e2e-feature',
        promptId: 'e2e-prompt',
        promptVersion: 1,
        costUsd: '0.000100',
        status: 'error',
        errorCode: 'timeout',
        attempts: 3,
      });
      expect(saved?.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(saved?.createdAt).toBeInstanceOf(Date);
    });

    it('sums cost exactly, only from the given time onwards', async () => {
      await store.record(row({ costUsd: '0.100000' }));
      await store.record(row({ costUsd: '0.200000' }));
      await store.record(row({ feature: 'old', costUsd: '9.000000' }));
      await calls.update(
        { feature: 'old' },
        { createdAt: new Date(Date.now() - 86_400_000) },
      );

      // 0.1 + 0.2 is 0.30000000000000004 in floating point; numeric stays exact.
      expect(await store.sumCostSince(new Date(Date.now() - 3_600_000))).toBe(
        '0.300000',
      );
    });

    it('returns 0 when there are no rows', async () => {
      expect(await store.sumCostSince(new Date(0))).toBe('0');
    });

    it('sums usage for one correlation id only, with cost kept exact', async () => {
      await store.record(
        row({ correlationId: 'quiz-a', costUsd: '0.100000', attempts: 2 }),
      );
      await store.record(row({ correlationId: 'quiz-a', costUsd: '0.200000' }));
      await store.record(row({ correlationId: 'quiz-b', costUsd: '5.000000' }));
      await store.record(row({ costUsd: '7.000000' }));

      expect(await store.sumUsageByCorrelationId('quiz-a')).toEqual({
        calls: 2,
        attempts: 3,
        inputTokens: 20,
        outputTokens: 40,
        costUsd: '0.300000',
      });
    });

    it('returns zero usage for a correlation id with no calls', async () => {
      expect(await store.sumUsageByCorrelationId('nobody')).toEqual({
        calls: 0,
        attempts: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: '0.000000',
      });
    });

    it('rejects an unknown status (CHECK constraint)', async () => {
      await expect(
        store.record(row({ status: 'nonsense' as LlmCallRecord['status'] })),
      ).rejects.toThrow(/CHK_llm_calls_status/);
    });
  });

  describe('status constraint', () => {
    // migration:generate cannot see a changed CHECK expression, so this
    // catches an entity status that no migration added to the database.
    it.each(LLM_CALL_STATUSES)('accepts the status "%s"', async (status) => {
      await expect(store.record(row({ status }))).resolves.toBeUndefined();
    });
  });

  describe('RedisLlmCache', () => {
    it('stores a value with a TTL and reads it back', async () => {
      const key = `e2e-${randomUUID()}`;

      await cache.set(key, '{"ok":true}', 30);

      expect(await cache.get(key)).toBe('{"ok":true}');
    });

    it('returns null for a missing key', async () => {
      expect(await cache.get(`e2e-missing-${randomUUID()}`)).toBeNull();
    });
  });
});
