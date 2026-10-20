import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Quiz } from '../quiz/quiz.entity.js';

/** One answer as stored: whether it was correct is saved, so the stats are a plain sum. */
export interface StoredAnswer {
  questionId: string;
  selectedIndex: number;
  correct: boolean;
}

/** One student's submitted attempt at a published quiz, scored on the server. */
@Entity('attempts')
// Serves the attempt stats, which read every attempt of one quiz.
@Index('IDX_attempts_quiz_id', ['quizId'])
export class Attempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'quiz_id', type: 'uuid' })
  quizId: string;

  // RESTRICT, like quizzes -> lessons: deleting a quiz must never silently delete its attempts.
  @ManyToOne(() => Quiz, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'quiz_id' })
  quiz?: Relation<Quiz>;

  /** Every question's answer, in question order. */
  @Column({ type: 'jsonb' })
  answers: StoredAnswer[];

  /** How many answers were correct (out of answers.length). */
  @Column({ type: 'integer' })
  score: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
