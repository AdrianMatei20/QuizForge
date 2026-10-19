import { Injectable } from '@nestjs/common';

/**
 * Ids of the quizzes this process is generating right now, synchronous or
 * streamed. The stuck-quiz sweep skips them: a quiz that is "generating"
 * and in this set is still being worked on, not abandoned by a crash.
 */
@Injectable()
export class ActiveGenerations {
  private readonly ids = new Set<string>();

  add(quizId: string): void {
    this.ids.add(quizId);
  }

  delete(quizId: string): void {
    this.ids.delete(quizId);
  }

  has(quizId: string): boolean {
    return this.ids.has(quizId);
  }
}
