import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EvalRun } from './eval-run.entity.js';
import { EvalRunsService } from './eval-runs.service.js';

/** eval_runs only, without the LLM stack: enough for the API and for eval:compare and eval:sample. */
@Module({
  imports: [TypeOrmModule.forFeature([EvalRun])],
  providers: [EvalRunsService],
  exports: [EvalRunsService, TypeOrmModule],
})
export class EvalRunsModule {}
