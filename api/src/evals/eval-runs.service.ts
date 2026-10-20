import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Repository } from 'typeorm';
import { type ComparedMetric, compareMetrics } from './compare.js';
import { API_DIR } from './eval-paths.js';
import { EvalRun } from './eval-run.entity.js';
import type { EvalReport } from './eval.types.js';

/** Shortest id prefix the command-line tools accept. */
export const MIN_ID_PREFIX = 6;

export interface EvalComparison {
  a: EvalRun;
  b: EvalRun;
  metrics: ComparedMetric[];
}

/** Reads eval_runs: for the API, eval:compare and eval:sample. Needs only the database. */
@Injectable()
export class EvalRunsService {
  constructor(
    @InjectRepository(EvalRun) private readonly runs: Repository<EvalRun>,
  ) {}

  /** Newest first; dry runs only when asked for. */
  list(limit: number, includeDryRuns: boolean): Promise<EvalRun[]> {
    return this.runs.find({
      where: includeDryRuns ? {} : { dryRun: false },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
    });
  }

  async get(id: string): Promise<EvalRun> {
    const run = await this.runs.findOneBy({ id });
    if (!run) {
      throw new NotFoundException(`Eval run ${id} was not found`);
    }
    return run;
  }

  /** A full id, or a unique prefix of one (at least MIN_ID_PREFIX characters), as the CLI prints them. */
  async findByIdOrPrefix(idOrPrefix: string): Promise<EvalRun> {
    const prefix = idOrPrefix.trim().toLowerCase();
    if (!/^[0-9a-f-]+$/.test(prefix) || prefix.length < MIN_ID_PREFIX) {
      throw new Error(
        `"${idOrPrefix}" is not a run id (or a prefix of at least ${MIN_ID_PREFIX} characters)`,
      );
    }
    const matches = await this.runs
      .createQueryBuilder('run')
      .where('run.id::text LIKE :prefix', { prefix: `${prefix}%` })
      .take(2)
      .getMany();
    if (matches.length === 0) {
      throw new NotFoundException(`No eval run id starts with ${prefix}`);
    }
    if (matches.length > 1) {
      throw new ConflictException(
        `More than one eval run id starts with ${prefix}; give more characters`,
      );
    }
    return matches[0] as EvalRun;
  }

  compare(a: EvalRun, b: EvalRun): EvalComparison {
    return {
      a,
      b,
      metrics: compareMetrics(a.metrics.overall, b.metrics.overall),
    };
  }

  /** The JSON report next to the run's Markdown report: every question with its verdict. */
  readReport(run: EvalRun): EvalReport {
    const file = join(API_DIR, run.reportFile.replace(/\.md$/, '.json'));
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as EvalReport;
    } catch (error) {
      throw new Error(`Cannot read the run's JSON report at ${file}`, {
        cause: error,
      });
    }
  }
}
