import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'lessons/new' },
  {
    path: 'lessons/new',
    title: 'New lesson · QuizForge',
    loadComponent: () => import('./lessons/lesson-new.page').then((m) => m.LessonNewPage),
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
  { path: '**', redirectTo: 'lessons/new' },
];
