import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { TableModule } from 'primeng/table';
import { ChipModule } from 'primeng/chip';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { TeamStateService } from '../../services/team-state.service';
import { EspnApiService } from '../../services/espn-api.service';
import { TeamLogoComponent } from '../team-logo/team-logo.component';
import { LeagueTeamsRequest, Matchup, Standing } from '../../models/team.model';

@Component({
  selector: 'app-league',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    TableModule,
    ChipModule,
    CardModule,
    TagModule,
    ProgressSpinnerModule,
    MessageModule,
    ButtonModule,
    TeamLogoComponent,
  ],
  templateUrl: './league.component.html',
  styleUrl: './league.component.css',
})
export class LeagueComponent {
  protected readonly teamState = inject(TeamStateService);
  private readonly espnApi = inject(EspnApiService);
  private readonly router = inject(Router);

  protected readonly myTeamId = this.teamState.myTeamId;

  // Refetched on every visit (and on retry) so standings and live scores are never stale.
  private readonly reloadCount = signal(0);
  private readonly leagueRequest = computed<LeagueTeamsRequest | null>(() => {
    const request = this.teamState.importRequest();
    if (!request) {
      return null;
    }
    this.reloadCount();
    const { leagueId, season, espnS2, swid } = request;
    return { leagueId, season, espnS2, swid };
  });
  private readonly leagueLoad = toSignal(
    toObservable(this.leagueRequest).pipe(
      switchMap((request) =>
        request
          ? this.espnApi.getLeague(request).pipe(
              map((league) => ({ league, error: null })),
              catchError((err) => of({ league: null, error: err?.error?.title ?? 'Could not load the league.' })),
              startWith(null),
            )
          : of(null),
      ),
    ),
    { initialValue: null },
  );

  protected readonly loading = computed(() => this.leagueRequest() !== null && this.leagueLoad() === null);
  protected readonly errorMessage = computed(() => this.leagueLoad()?.error ?? null);
  protected readonly league = computed(() => this.leagueLoad()?.league ?? null);

  private readonly standingsById = computed(
    () => new Map((this.league()?.standings ?? []).map((s) => [s.teamId, s] as const)),
  );

  // The user's own matchup goes first; the rest keep ESPN's order.
  protected readonly matchups = computed<Matchup[]>(() => {
    const myId = this.myTeamId();
    const all = this.league()?.matchups ?? [];
    const isMine = (m: Matchup) => m.home.teamId === myId || m.away.teamId === myId;
    return [...all.filter(isMine), ...all.filter((m) => !isMine(m))];
  });

  protected retry(): void {
    this.reloadCount.update((n) => n + 1);
  }

  protected standing(teamId: number): Standing | undefined {
    return this.standingsById().get(teamId);
  }

  protected isMine(teamId: number): boolean {
    return teamId === this.myTeamId();
  }

  // The user's own team links to plain /team so the My Team nav tab lights up.
  protected teamLink(teamId: number): string {
    return this.isMine(teamId) ? '/team' : `/team/${teamId}`;
  }

  protected openTeam(teamId: number): void {
    this.router.navigateByUrl(this.teamLink(teamId));
  }

  protected record(s: Standing): string {
    return s.ties ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`;
  }

  protected streakSeverity(streak: string): 'success' | 'danger' | 'secondary' {
    return streak.startsWith('W') ? 'success' : streak.startsWith('L') ? 'danger' : 'secondary';
  }
}
