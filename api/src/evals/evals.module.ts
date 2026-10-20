import { Module } from '@nestjs/common';
import { EvalRunsModule } from './eval-runs.module.js';
import { EvalsController } from './evals.controller.js';

/** The API side of the eval harness: reading runs. Running one is EvalCliModule's job. */
@Module({
  imports: [EvalRunsModule],
  controllers: [EvalsController],
})
export class EvalsModule {}
