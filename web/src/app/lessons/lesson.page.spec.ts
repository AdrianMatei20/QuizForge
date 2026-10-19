import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import type { LessonResponse, QuizListItem } from '../core/api/api.types';
import { LessonsApi } from '../core/api/lessons.api';
import { QuizzesApi } from '../core/api/quizzes.api';
import { LessonPage } from './lesson.page';

const LESSON: LessonResponse = {
  id: 'lesson-1',
  title: 'Recursion',
  content: 'A recursive function calls itself.\n\nEvery recursion needs a base case.',
  contentHash: 'f'.repeat(64),
  createdAt: '2026-10-19T12:00:00.000Z',
};

const quiz = (id: string, overrides: Partial<QuizListItem> = {}): QuizListItem => ({
  id,
  status: 'draft',
  failureReason: null,
  settings: { count: 5, difficulty: 'medium', types: ['multiple_choice'] },
  createdAt: '2026-10-19T12:00:00.000Z',
  questionCount: 5,
  ...overrides,
});

describe('LessonPage', () => {
  let startStreaming: ReturnType<typeof vi.fn>;

  const setUp = (quizzes: QuizListItem[]) => {
    startStreaming = vi.fn(() => of({ quizId: 'new-quiz' }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LessonsApi, useValue: { get: vi.fn(() => of(LESSON)) } },
        {
          provide: QuizzesApi,
          useValue: { listForLesson: vi.fn(() => of(quizzes)), startStreaming },
        },
      ],
    });
  };

  /** The page awaits two requests together; let that settle, then render. */
  const settle = async (fixture: { whenStable(): Promise<unknown> }) => {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };

  const render = async () => {
    const fixture = TestBed.createComponent(LessonPage);
    fixture.componentRef.setInput('id', 'lesson-1');
    await settle(fixture);
    return { fixture, element: fixture.nativeElement as HTMLElement };
  };

  const button = (element: HTMLElement, name: string) => {
    const found = [...element.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(name),
    );
    if (!found) throw new Error(`no "${name}" button`);
    return found;
  };

  it('shows the title, the content in a collapsed preview, and the quizzes newest first', async () => {
    setUp([
      quiz('newer', { status: 'failed', failureReason: 'timeout', questionCount: 0 }),
      quiz('older', { status: 'published', questionCount: 4 }),
    ]);
    const { element } = await render();

    expect(element.querySelector('h1')?.textContent).toBe('Recursion');
    const preview = element.querySelector('details');
    expect(preview?.open).toBe(false);
    expect(preview?.querySelector('.lesson-text')?.textContent).toBe(LESSON.content);

    const items = element.querySelectorAll('app-quiz-history-item');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('Failed because the AI service took too long.');
    expect(items[1]?.textContent).toContain('4 of 5 questions');
  });

  it('says when the lesson has no quizzes yet', async () => {
    setUp([]);
    const { element } = await render();

    expect(element.querySelector('.empty')?.textContent).toContain('No quizzes yet');
  });

  it('generates another quiz with the chosen settings and opens its review board', async () => {
    setUp([quiz('q1')]);
    const { fixture, element } = await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const toggle = button(element, 'Generate another quiz');
    toggle.click();
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    const count = element.querySelector<HTMLInputElement>('#quiz-count');
    if (!count) throw new Error('count field missing');
    count.value = '7';
    count.dispatchEvent(new Event('input'));
    button(element, 'Generate quiz').click();
    await settle(fixture);

    expect(startStreaming).toHaveBeenCalledWith('lesson-1', {
      count: 7,
      difficulty: 'medium',
      types: ['multiple_choice', 'true_false'],
    });
    expect(navigate).toHaveBeenCalledWith(['/quizzes', 'new-quiz', 'review']);
  });

  it('checks the settings before calling the API', async () => {
    setUp([]);
    const { fixture, element } = await render();
    button(element, 'Generate another quiz').click();
    await fixture.whenStable();

    for (const checkbox of element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      checkbox.click();
    }
    button(element, 'Generate quiz').click();
    await fixture.whenStable();

    expect(startStreaming).not.toHaveBeenCalled();
    expect(element.querySelector('#quiz-types-errors')?.textContent).toContain(
      'Choose at least one question type.',
    );
  });
});
