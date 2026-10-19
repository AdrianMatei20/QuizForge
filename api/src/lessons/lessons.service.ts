import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import type { Repository } from 'typeorm';
import { assertLessonContentLength } from './lesson-content.js';
import { Lesson } from './lesson.entity.js';

@Injectable()
export class LessonsService {
  constructor(
    @InjectRepository(Lesson) private readonly lessons: Repository<Lesson>,
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
}
