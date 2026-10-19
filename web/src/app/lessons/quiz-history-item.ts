import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { QuizListItem } from '../core/api/api.types';
import { failureSentence, settingsSummary } from '../shared/quiz-labels';
import { QuizStatusBadge } from '../shared/quiz-status-badge';

/**
 * One quiz on the lesson page: status, questions against the requested
 * count, settings, date, and where to go next. A generating quiz opens the
 * review board, which resumes its live stream.
 */
@Component({
  selector: 'app-quiz-history-item',
  imports: [DatePipe, QuizStatusBadge, RouterLink],
  template: `
    @let item = quiz();
    <div class="summary">
      <app-quiz-status-badge [status]="item.status" />
      @if (item.status !== 'failed') {
        <span class="count">{{ item.questionCount }} of {{ item.settings.count }} questions</span>
      }
      <span class="meta">{{ settings() }}</span>
      <time class="meta" [attr.datetime]="item.createdAt">{{
        item.createdAt | date: 'medium'
      }}</time>
    </div>
    @switch (item.status) {
      @case ('failed') {
        <p class="failure">{{ failure() }}</p>
      }
      @case ('published') {
        <a [routerLink]="['/quizzes', item.id, 'published']">
          View the published quiz<span class="visually-hidden">
            from {{ item.createdAt | date: 'medium' }}</span
          >
        </a>
      }
      @default {
        <a [routerLink]="['/quizzes', item.id, 'review']">
          {{ item.status === 'generating' ? 'Follow the generation' : 'Review'
          }}<span class="visually-hidden">
            the quiz from {{ item.createdAt | date: 'medium' }}</span
          >
        </a>
      }
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--space-2);
      padding: var(--space-4);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      background: var(--color-surface);
    }

    .summary {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-4);
    }

    .count {
      font-weight: 600;
    }

    .meta {
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }

    .failure {
      margin: 0;
      color: var(--color-danger);
    }
  `,
})
export class QuizHistoryItem {
  readonly quiz = input.required<QuizListItem>();

  protected readonly settings = computed(() => settingsSummary(this.quiz().settings));
  protected readonly failure = computed(() => failureSentence(this.quiz().failureReason));
}
