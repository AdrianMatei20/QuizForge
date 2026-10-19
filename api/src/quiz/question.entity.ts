import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { checkIn } from '../database/check-in.js';
import type { GeneratedQuestion } from './quiz-output.schema.js';
import { Quiz } from './quiz.entity.js';
import {
  QUESTION_STATUSES,
  QUESTION_TYPES,
  type QuestionStatus,
  type QuestionType,
} from './quiz.types.js';

@Entity('questions')
@Check('CHK_questions_type', checkIn('type', QUESTION_TYPES))
@Check('CHK_questions_status', checkIn('status', QUESTION_STATUSES))
@Check('CHK_questions_correct_index', '"correct_index" >= 0')
// Not unique: reordering questions later would trip over a unique index.
@Index('IDX_questions_quiz_id_position', ['quizId', 'position'])
export class Question {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'quiz_id', type: 'uuid' })
  quizId: string;

  // CASCADE: questions have no meaning without their quiz.
  @ManyToOne(() => Quiz, (quiz) => quiz.questions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quiz_id' })
  quiz?: Relation<Quiz>;

  /** 1-based order within the quiz. */
  @Column({ type: 'integer' })
  position: number;

  @Column({ type: 'varchar', length: 20 })
  type: QuestionType;

  @Column({ type: 'text' })
  stem: string;

  @Column({ type: 'jsonb' })
  options: string[];

  @Column({ name: 'correct_index', type: 'integer' })
  correctIndex: number;

  @Column({ type: 'text' })
  explanation: string;

  @Column({ name: 'source_quote', type: 'text' })
  sourceQuote: string;

  @Column({ type: 'varchar', length: 20 })
  status: QuestionStatus;

  /** The question exactly as the model generated it, kept when a teacher edits it. */
  @Column({ type: 'jsonb' })
  original: GeneratedQuestion;

  @Column({ name: 'edited_at', type: 'timestamptz', nullable: true })
  editedAt: Date | null;

  // Soft delete: TypeORM's find methods skip rows where this is set.
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
