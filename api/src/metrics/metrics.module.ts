import { Global, Module } from '@nestjs/common';
import { LlmMetrics } from './llm-metrics.js';
import { MetricsController } from './metrics.controller.js';

/** Global: LlmModule records into LlmMetrics; GET /metrics serves its registry. */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    {
      provide: LlmMetrics,
      useFactory: () => new LlmMetrics({ defaultMetrics: true }),
    },
  ],
  exports: [LlmMetrics],
})
export class MetricsModule {}
