import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import type { LessonList, LessonSummary } from '../core/api/api.types';
import { LessonsApi } from '../core/api/lessons.api';
import { LessonsListPage, quizCountsSummary } from './lessons-list.page';

const NO_QUIZZES = { generating: 0, draft: 0, published: 0, failed: 0 };

const lesson = (id: string, overrides: Partial<LessonSummary> = {}): LessonSummary => ({
  id,
  title: `Lesson ${id}`,
  createdAt: '2026-10-19T12:00:00.000Z',
  quizCounts: NO_QUIZZES,
  ...overrides,
});

describe('LessonsListPage', () => {
  let list: ReturnType<typeof vi.fn>;

  const setUp = (page: LessonList) => {
    list = vi.fn(() => of(page));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: LessonsApi, useValue: { list } }],
    });
  };

  const render = async (offset?: string) => {
    const fixture = TestBed.createComponent(LessonsListPage);
    if (offset !== undefined) {
      fixture.componentRef.setInput('offset', offset);
    }
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  it('points to New lesson when there are no lessons yet', async () => {
    setUp({ items: [], total: 0, limit: 20, offset: 0 });
    const element = await render();

    const empty = element.querySelector('.empty-state');
    expect(empty?.textContent).toContain('No lessons yet');
    expect(empty?.querySelector('a')?.getAttribute('href')).toBe('/lessons/new');
    expect(element.querySelector('.lesson-list')).toBeNull();
  });

  it('lists lessons with a link, the date and their quiz counts', async () => {
    setUp({
      items: [
        lesson('a', {
          title: 'Recursion',
          quizCounts: { generating: 0, draft: 2, published: 1, failed: 1 },
        }),
        lesson('b'),
      ],
      total: 2,
      limit: 20,
      offset: 0,
    });
    const element = await render();

    const rows = element.querySelectorAll('.lesson-row');
    expect(rows).toHaveLength(2);
    const title = rows[0]?.querySelector('a');
    expect(title?.textContent?.trim()).toBe('Recursion');
    expect(title?.getAttribute('href')).toBe('/lessons/a');
    expect(rows[0]?.textContent).toContain('Oct 19, 2026');
    expect(rows[0]?.querySelector('.quiz-counts')?.textContent?.trim()).toBe(
      '2 draft · 1 published · 1 failed',
    );
    expect(rows[1]?.querySelector('.quiz-counts')?.textContent?.trim()).toBe('No quizzes yet');
    // One page only: no pager.
    expect(element.querySelector('.pager')).toBeNull();
    expect(element.querySelector('a.button')?.getAttribute('href')).toBe('/lessons/new');
  });

  it('asks for the page in the URL and links to the newer and older pages', async () => {
    setUp({ items: [lesson('c')], total: 45, limit: 20, offset: 20 });
    const element = await render('20');

    expect(list).toHaveBeenCalledWith({ limit: 20, offset: 20 });
    const links = [...element.querySelectorAll('.pager a')].map((a) => [
      a.textContent?.trim(),
      a.getAttribute('href'),
    ]);
    expect(links).toEqual([
      ['Newer', '/'],
      ['Older', '/?offset=40'],
    ]);
    expect(element.querySelector('.pager')?.textContent).toContain('21–21 of 45');
  });

  it('treats a nonsense offset as the first page', async () => {
    setUp({ items: [lesson('a')], total: 1, limit: 20, offset: 0 });
    await render('-5');

    expect(list).toHaveBeenCalledWith({ limit: 20, offset: 0 });
  });
});

describe('quizCountsSummary', () => {
  it('lists the statuses that have quizzes, in a fixed order', () => {
    expect(quizCountsSummary({ generating: 1, draft: 0, published: 3, failed: 0 })).toBe(
      '1 generating · 3 published',
    );
    expect(quizCountsSummary(NO_QUIZZES)).toBe('No quizzes yet');
  });
});
