import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
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
    expect(compiled.querySelector('nav[aria-label="Main"] a')?.textContent).toContain('New lesson');
  });

  it('opens the lesson editor at the root route', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/');

    expect(TestBed.inject(Router).url).toBe('/lessons/new');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain('New lesson');
  });

  it('redirects unknown routes to the lesson editor', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/nowhere');

    expect(TestBed.inject(Router).url).toBe('/lessons/new');
  });
});
