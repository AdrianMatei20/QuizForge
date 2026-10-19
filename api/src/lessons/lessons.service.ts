import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { In, type Repository } from 'typeorm';
import { Quiz } from '../quiz/quiz.entity.js';
import { QUIZ_STATUSES, type QuizStatus } from '../quiz/quiz.types.js';
import { assertLessonContentLength } from './lesson-content.js';
import { Lesson } from './lesson.entity.js';

export type QuizStatusCounts = Record<QuizStatus, number>;

/** A lesson in the list: no content, plus how many quizzes it has in each status. */
export interface LessonSummary {
  id: string;
  title: string;
  createdAt: Date;
  quizCounts: QuizStatusCounts;
}

export interface LessonPage {
  lessons: LessonSummary[];
  /** All lessons, not just this page. */
  total: number;
}

@Injectable()
export class LessonsService {
  constructor(
    @InjectRepository(Lesson) private readonly lessons: Repository<Lesson>,
    @InjectRepository(Quiz) private readonly quizzes: Repository<Quiz>,
  ) {}

  /** Stores the trimmed title and content; the hash is of the stored content. */
  async create(input: { title: string; content: string }): Promise<Lesson> {
    assertLessonContentLength(input.content);
    const content = input.content.trim();
    return this.lessons.save(
      this.lessons.create({
        title: input.title.trim(),
        content,
        contentHash: createHash('sha256').update(content).digest('hex'),
      }),
    );
  }

  async findById(id: string): Promise<Lesson> {
    const lesson = await this.lessons.findOneBy({ id });
    if (!lesson) {
      throw new NotFoundException(`Lesson ${id} was not found`);
    }
    return lesson;
  }

  /**
   * Newest first; the id breaks ties so that pages never overlap or skip a
   * lesson when two share a timestamp. Two queries: the page of lessons, then
   * the quiz counts for just those lessons.
   */
  async list(limit: number, offset: number): Promise<LessonPage> {
    const [lessons, total] = await this.lessons.findAndCount({
      select: { id: true, title: true, createdAt: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
      skip: offset,
    });
    const counts = await this.quizCounts(lessons.map((lesson) => lesson.id));
    return {
      lessons: lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        createdAt: lesson.createdAt,
        quizCounts: counts.get(lesson.id) ?? emptyCounts(),
      })),
      total,
    };
  }

  private async quizCounts(
    lessonIds: string[],
  ): Promise<Map<string, QuizStatusCounts>> {
    const counts = new Map<string, QuizStatusCounts>();
    if (lessonIds.length === 0) {
      return counts;
    }
    const rows = await this.quizzes
      .createQueryBuilder('quiz')
      .select('quiz.lessonId', 'lessonId')
      .addSelect('quiz.status', 'status')
      .addSelect('COUNT(*)::int', 'count')
      .where({ lessonId: In(lessonIds) })
      .groupBy('quiz.lessonId')
      .addGroupBy('quiz.status')
      .getRawMany<{ lessonId: string; status: QuizStatus; count: number }>();
    for (const row of rows) {
      const lessonCounts = counts.get(row.lessonId) ?? emptyCounts();
      lessonCounts[row.status] = row.count;
      counts.set(row.lessonId, lessonCounts);
    }
    return counts;
  }
}

function emptyCounts(): QuizStatusCounts {
  return Object.fromEntries(
    QUIZ_STATUSES.map((status) => [status, 0]),
  ) as QuizStatusCounts;
}
