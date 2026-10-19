import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { QuizListItem } from '../core/api/api.types';
import { QuizHistoryItem } from './quiz-history-item';

const QUIZ: QuizListItem = {
  id: 'quiz-1',
  status: 'draft',
  failureReason: null,
  settings: { count: 5, difficulty: 'medium', types: ['multiple_choice', 'true_false'] },
  createdAt: '2026-10-19T12:00:00.000Z',
  questionCount: 4,
};

describe('QuizHistoryItem', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  const render = async (quiz: Partial<QuizListItem>) => {
    const fixture = TestBed.createComponent(QuizHistoryItem);
    fixture.componentRef.setInput('quiz', { ...QUIZ, ...quiz });
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    return {
      element,
      text: element.textContent?.replace(/\s+/g, ' ') ?? '',
      link: element.querySelector('a'),
    };
  };

  it('shows the status, the questions against the requested count, and the settings', async () => {
    const { element, text } = await render({});

    expect(element.querySelector('.badge')?.textContent?.trim()).toBe('Draft');
    expect(text).toContain('4 of 5 questions');
    expect(text).toContain('Medium · multiple choice, true/false');
  });

  it('links a draft to the review board', async () => {
    const { link } = await render({ status: 'draft' });

    expect(link?.getAttribute('href')).toBe('/quizzes/quiz-1/review');
    expect(link?.textContent).toContain('Review');
  });

  it('links a generating quiz to the review board, where its stream resumes', async () => {
    const { element, link } = await render({ status: 'generating', questionCount: 2 });

    expect(element.querySelector('.badge')?.textContent?.trim()).toBe('Generating');
    expect(link?.getAttribute('href')).toBe('/quizzes/quiz-1/review');
    expect(link?.textContent).toContain('Follow the generation');
  });

  it('links a published quiz to the published view', async () => {
    const { link } = await render({ status: 'published', questionCount: 3 });

    expect(link?.getAttribute('href')).toBe('/quizzes/quiz-1/published');
  });

  it('explains a failed quiz in a sentence, without the reason code or a link', async () => {
    const { element, text, link } = await render({
      status: 'failed',
      failureReason: 'rate_limited',
      questionCount: 0,
    });

    expect(element.querySelector('.failure')?.textContent?.trim()).toBe(
      'Failed because the AI service was busy.',
    );
    expect(text).not.toContain('rate_limited');
    expect(text).not.toContain('questions');
    expect(link).toBeNull();
  });
});
