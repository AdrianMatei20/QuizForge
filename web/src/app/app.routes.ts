import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Lessons · QuizForge',
    loadComponent: () => import('./lessons/lessons-list.page').then((m) => m.LessonsListPage),
  },
  {
    path: 'lessons/new',
    title: 'New lesson · QuizForge',
    loadComponent: () => import('./lessons/lesson-new.page').then((m) => m.LessonNewPage),
  },
  {
    path: 'lessons/:id',
    title: 'Lesson · QuizForge',
    loadComponent: () => import('./lessons/lesson.page').then((m) => m.LessonPage),
  },
  {
    path: 'quizzes/:id/review',
    title: 'Review quiz · QuizForge',
    loadComponent: () => import('./review/review-board.page').then((m) => m.ReviewBoardPage),
  },
  {
    path: 'quizzes/:id/published',
    title: 'Published quiz · QuizForge',
    loadComponent: () => import('./published/published-quiz.page').then((m) => m.PublishedQuizPage),
  },
  {
    path: 'usage',
    title: 'Usage · QuizForge',
    loadComponent: () => import('./usage/usage.page').then((m) => m.UsagePage),
  },
  {
    path: 'evals',
    title: 'Evals · QuizForge',
    loadComponent: () => import('./evals/evals.page').then((m) => m.EvalsPage),
  },
  {
    path: 'evals/compare',
    title: 'Compare eval runs · QuizForge',
    loadComponent: () => import('./evals/eval-compare.page').then((m) => m.EvalComparePage),
  },
  { path: '**', redirectTo: '' },
];
