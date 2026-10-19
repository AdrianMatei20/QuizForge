import { Controller, Get, Header } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { ApiProblems } from '../docs/api-problems.js';
import { LlmMetrics } from './llm-metrics.js';

/** Prometheus scrape endpoint, at the root next to /health (not under /api). */
@ApiTags('health')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: LlmMetrics) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({
    summary: 'Prometheus metrics',
    description:
      'LLM metrics (llm_requests_total, llm_latency_seconds, llm_tokens_total, llm_cost_usd_total) and default Node.js process metrics, in the Prometheus text format. Unauthenticated: see the README known limitations.',
  })
  @ApiProduces('text/plain')
  @ApiOkResponse({
    description: 'Prometheus text exposition format.',
    content: { 'text/plain': { schema: { type: 'string' } } },
  })
  @ApiProblems()
  scrape(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}
