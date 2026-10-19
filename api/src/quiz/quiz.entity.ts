import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { checkIn } from '../database/check-in.js';
import { Lesson } from '../lessons/lesson.entity.js';
import { Question } from './question.entity.js';
import {
  QUIZ_FAILURE_REASONS,
  QUIZ_STATUSES,
  type QuizFailureReason,
  type QuizSettings,
  type QuizStatus,
} from './quiz.types.js';

/**
 * A generated quiz. prompt_id, prompt_version and model record exactly which
 * prompt and model produced it (CLAUDE.md: every stored LLM result does).
 */
@Entity('quizzes')
@Check('CHK_quizzes_status', checkIn('status', QUIZ_STATUSES))
// NULL passes a CHECK, so this only constrains non-null values.
@Check(
  'CHK_quizzes_failure_reason',
  checkIn('failure_reason', QUIZ_FAILURE_REASONS),
)
// A failed quiz always says why, and only a failed quiz has a reason.
@Check(
  'CHK_quizzes_failed_has_reason',
  `("status" = 'failed') = ("failure_reason" IS NOT NULL)`,
)
// Serves "a lesson's quizzes, newest first" (and lesson_id lookups alone).
@Index('IDX_quizzes_lesson_id_created_at', ['lessonId', 'createdAt'])
export class Quiz {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'lesson_id', type: 'uuid' })
  lessonId: string;

  // RESTRICT: deleting a lesson must never silently delete its quizzes.
  @ManyToOne(() => Lesson, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'lesson_id' })
  lesson?: Relation<Lesson>;

  @Column({ type: 'varchar', length: 20 })
  status: QuizStatus;

  @Column({ name: 'prompt_id', type: 'varchar', length: 100 })
  promptId: string;

  @Column({ name: 'prompt_version', type: 'integer' })
  promptVersion: number;

  @Column({ type: 'varchar', length: 100 })
  model: string;

  @Column({ type: 'jsonb' })
  settings: QuizSettings;

  /**
   * Streamed generation only: lines the model wrote that failed validation
   * (before the repair step). Kept so a reconnecting client gets the same
   * `done` counts after the run has ended.
   */
  @Column({ name: 'stream_rejected', type: 'integer', default: 0 })
  streamRejected: number;

  /** Set whenever the quiz ends as "failed"; null otherwise. */
  @Column({
    name: 'failure_reason',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  failureReason: QuizFailureReason | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => Question, (question) => question.quiz)
  // Relation<> keeps decorator metadata from touching Question while the
  // two entity modules import each other (ESM circular import).
  questions?: Relation<Question>[];
}
