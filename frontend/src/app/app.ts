import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { TabsModule } from 'primeng/tabs';
import { ButtonModule } from 'primeng/button';
import { TeamStateService } from './services/team-state.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, TabsModule, ButtonModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = 'FantasyX';
  private readonly router = inject(Router);

  // My Team / League only make sense once a team (and its league context) has been imported.
  protected readonly hasTeam = inject(TeamStateService).team;

  protected readonly tabs = [
    { route: '/team', label: 'My Team', icon: 'pi pi-user' },
    { route: '/league', label: 'League', icon: 'pi pi-trophy' },
  ];

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  // No tab is active while viewing another team (/team/:teamId) or the import page.
  protected readonly activeTab = computed(() => this.tabs.find((t) => t.route === this.url())?.route ?? '');

  protected navigate(route: string | number | undefined): void {
    if (typeof route === 'string' && route !== this.url()) {
      this.router.navigateByUrl(route);
    }
  }

  protected goToImport(): void {
    this.router.navigateByUrl('/import');
  }
}
