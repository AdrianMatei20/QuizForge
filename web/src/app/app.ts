import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

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

  /**
   * "Lessons" covers everything reached from a lesson: the list, a lesson,
   * the editor and its quizzes. routerLinkActive cannot express that, since
   * "/" is a prefix of every URL.
   */
  /**
   * /q/:id is for students: no teacher navigation, and the brand is not a
   * link into the teacher's pages.
   */
  protected readonly studentPage = computed(() => this.url().startsWith('/q/'));

  protected readonly lessonsActive = computed(() => {
    const path = this.url().split(/[?#]/)[0] ?? '';
    return path === '/' || path.startsWith('/lessons') || path.startsWith('/quizzes');
  });
}
