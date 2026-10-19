import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('lessons')
export class Lesson {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text' })
  content: string;

  // sha256 (hex) of content: lets later features spot the same lesson
  // submitted twice without comparing up to 20,000 characters.
  @Index('IDX_lessons_content_hash')
  @Column({ name: 'content_hash', type: 'char', length: 64 })
  contentHash: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
