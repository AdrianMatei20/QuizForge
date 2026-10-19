import { TestBed } from '@angular/core/testing';
import type { QuizStatus } from '../core/api/api.types';
import { QuizStatusBadge } from './quiz-status-badge';

describe('QuizStatusBadge', () => {
  it.each([
    ['generating', 'Generating'],
    ['draft', 'Draft'],
    ['published', 'Published'],
    ['failed', 'Failed'],
  ] as [QuizStatus, string][])(
    'shows %s as the word "%s" with its own style',
    async (status, label) => {
      const fixture = TestBed.createComponent(QuizStatusBadge);
      fixture.componentRef.setInput('status', status);
      await fixture.whenStable();

      const badge = (fixture.nativeElement as HTMLElement).querySelector('.badge');
      // The text carries the status, so it never depends on colour alone.
      expect(badge?.textContent?.trim()).toBe(label);
      expect(badge?.classList).toContain(`quiz-${status}`);
    },
  );
});
