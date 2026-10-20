import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { catchError, filter, map, of } from 'rxjs';
import { InfoApi } from './core/api/info.api';

@Component({
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  private readonly router = inject(Router);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** Null until loaded, and if the API cannot say: then no banner, rather than a wrong one. */
  protected readonly info = toSignal(
    inject(InfoApi)
      .get()
      .pipe(catchError(() => of(null))),
    { initialValue: null },
  );

  /**
   * /q/:id is for students: no teacher navigation, no demo banner, and the
   * brand is not a link into the teacher's pages.
   */
  protected readonly studentPage = computed(() => this.url().startsWith('/q/'));

  /**
   * "Lessons" covers everything reached from a lesson: the list, a lesson,
   * the editor and its quizzes. routerLinkActive cannot express that, since
   * "/" is a prefix of every URL.
   */
  protected readonly lessonsActive = computed(() => {
    const path = this.url().split(/[?#]/)[0] ?? '';
    return path === '/' || path.startsWith('/lessons') || path.startsWith('/quizzes');
  });

  /** "Binary search, HTTP caching and Recursion". */
  protected readonly sampleTitles = computed(() => {
    const titles = this.info()?.sampleLessons ?? [];
    return titles.length > 1
      ? `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}`
      : (titles[0] ?? '');
  });
}
