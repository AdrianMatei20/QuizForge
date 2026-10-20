import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
  });

  it('renders the brand link and the main navigation', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('header .brand')?.textContent).toContain('QuizForge');
    const links = [...compiled.querySelectorAll('nav[aria-label="Main"] a')].map((link) =>
      link.textContent?.trim(),
    );
    expect(links).toEqual(['Lessons', 'Usage', 'Evals']);
  });

  it('opens the lessons list at the root route', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/');
    TestBed.inject(HttpTestingController)
      .expectOne((request) => request.url === '/api/lessons')
      .flush({ items: [], total: 0, limit: 20, offset: 0 });
    await harness.fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe('/');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain('Lessons');
  });

  it('marks Lessons as the current section on lesson and quiz pages, and not on Usage', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    const lessonsLink = () =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
        'nav[aria-label="Main"] a',
      );

    await router.navigateByUrl('/lessons/new');
    await fixture.whenStable();
    expect(lessonsLink()?.getAttribute('aria-current')).toBe('true');

    await router.navigateByUrl('/usage');
    await fixture.whenStable();
    expect(lessonsLink()?.getAttribute('aria-current')).toBeNull();
  });

  it('shows students no teacher navigation on the take-quiz page', async () => {
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/q/quiz-1');
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('nav[aria-label="Main"]')).toBeNull();
    expect(compiled.querySelector('header a.brand')).toBeNull();
    expect(compiled.querySelector('header .brand')?.textContent).toContain('QuizForge');
  });

  it('redirects unknown routes to the lessons list', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/nowhere');

    expect(TestBed.inject(Router).url).toBe('/');
  });
});
