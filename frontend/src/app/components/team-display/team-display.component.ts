import { Component, computed, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ChipModule } from 'primeng/chip';
import { MeterGroupModule, MeterItem } from 'primeng/metergroup';
import { RatingModule } from 'primeng/rating';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { TeamStateService } from '../../services/team-state.service';
import { EspnApiService } from '../../services/espn-api.service';
import { ProjectionsService } from '../../services/projections.service';
import { LeagueOutlookService } from '../../services/league-outlook.service';
import { ImportTeamRequest, Player, Team } from '../../models/team.model';
import { PlayerAvatarComponent } from '../player-avatar/player-avatar.component';
import { PlayerDetailDrawerComponent } from '../player-detail-drawer/player-detail-drawer.component';
import { ProjectionSourceComponent } from '../projection-source/projection-source.component';
import { RankMovementComponent } from '../rank-movement/rank-movement.component';
import { TAG_LABELS, formatOdds } from '../../utils/playoff-odds';
import { ordinal } from '../../utils/league-format';
import { formatGameTime, matchupStars, sortStarters, statusSeverity } from '../../utils/player-format';

@Component({
  selector: 'app-team-display',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TableModule,
    TagModule,
    ChipModule,
    MeterGroupModule,
    RatingModule,
    ProgressSpinnerModule,
    MessageModule,
    ButtonModule,
    PlayerDetailDrawerComponent,
    PlayerAvatarComponent,
    ProjectionSourceComponent,
    RankMovementComponent,
    SkeletonModule,
    TooltipModule,
  ],
  templateUrl: './team-display.component.html',
  styleUrl: './team-display.component.css',
})
export class TeamDisplayComponent {
  protected readonly teamState = inject(TeamStateService);
  private readonly espnApi = inject(EspnApiService);
  protected readonly projections = inject(ProjectionsService);
  private readonly outlook = inject(LeagueOutlookService);

  constructor() {
    this.outlook.ensureLoaded();
  }

  // Bound from the /team/:teamId route param; absent on plain /team, which means the user's own team.
  readonly teamId = input<string>();

  protected readonly isOwnTeam = computed(() => {
    const id = this.teamId();
    return id === undefined || Number(id) === this.teamState.myTeamId();
  });

  // The user's own team is the cached import result; any other team is fetched fresh on every visit.
  private readonly reloadCount = signal(0);
  private readonly otherTeamRequest = computed<ImportTeamRequest | null>(() => {
    const request = this.teamState.importRequest();
    if (!request || this.isOwnTeam()) {
      return null;
    }
    this.reloadCount();
    return { ...request, teamId: Number(this.teamId()) };
  });
  private readonly otherTeamLoad = toSignal(
    toObservable(this.otherTeamRequest).pipe(
      switchMap((request) =>
        request
          ? this.espnApi.getTeam(request).pipe(
              map((team) => ({ team, error: null })),
              catchError((err) => of({ team: null, error: err?.error?.title ?? 'Could not load that team.' })),
              startWith(null),
            )
          : of(null),
      ),
    ),
    { initialValue: null },
  );

  protected readonly loading = computed(() => this.otherTeamRequest() !== null && this.otherTeamLoad() === null);
  protected readonly errorMessage = computed(() => this.otherTeamLoad()?.error ?? null);
  protected readonly team = computed<Team | null>(() =>
    this.isOwnTeam() ? this.teamState.team() : (this.otherTeamLoad()?.team ?? null),
  );

  // The user's own team links to plain /matchup so the Matchup nav tab lights up.
  protected readonly matchupLink = computed(() => (this.isOwnTeam() ? '/matchup' : `/matchup/${this.teamId()}`));

  protected retry(): void {
    this.reloadCount.update((n) => n + 1);
  }

  protected readonly starters = computed<Player[]>(() => sortStarters(this.team()?.players ?? []));
  protected readonly bench = computed<Player[]>(() => (this.team()?.players ?? []).filter((p) => !p.starter));

  // Null while FantasyX projections are loading.
  protected readonly startersProjectedTotal = computed(() =>
    this.starters().reduce<number | null>((sum, p) => {
      const projected = this.projections.projected(p);
      return sum === null || projected === null ? null : sum + projected;
    }, 0),
  );
  protected readonly startersPointsTotal = computed(() => this.starters().reduce((sum, p) => sum + p.points, 0));

  // The power rank and playoff odds tiles, for whichever team is showing. Hidden if the league
  // couldn't be loaded; the odds tile also once the regular season is over.
  protected readonly showOutlook = computed(() => !this.outlook.error() && this.outlook.rankings()?.status !== 'unavailable');
  protected readonly powerRank = computed(() => {
    const team = this.team();
    return team ? this.outlook.rankOf(team.teamId) : undefined;
  });
  protected readonly rankedTeams = computed(() => this.outlook.rankings()?.rankings.length ?? 0);
  protected readonly showOdds = computed(() => {
    const odds = this.outlook.odds();
    return !odds || odds.status === 'loading' || odds.odds !== null;
  });
  protected readonly playoffOdds = computed(() => {
    const team = this.team();
    return team ? this.outlook.oddsOf(team.teamId) : undefined;
  });
  protected readonly formatOdds = formatOdds;
  protected readonly tagLabels = TAG_LABELS;
  // How hard the team's remaining regular-season schedule is, ranked across the league.
  protected readonly remainingSchedule = computed(() => {
    const team = this.team();
    return team ? this.outlook.scheduleOf(team.teamId) : undefined;
  });

  protected readonly statusSeverity = statusSeverity;
  protected readonly formatGameTime = formatGameTime;
  protected readonly matchupStars = matchupStars;

  // The player detail drawer steps through the roster in the order it's displayed.
  protected readonly orderedPlayers = computed(() => [...this.starters(), ...this.bench()]);
  private readonly selectedPlayerId = signal<number | null>(null);
  private readonly selectedIndex = computed(() =>
    this.orderedPlayers().findIndex((p) => p.playerId === this.selectedPlayerId()),
  );
  protected readonly selectedPlayer = computed(() => this.orderedPlayers()[this.selectedIndex()] ?? null);
  protected readonly hasPreviousPlayer = computed(() => this.selectedIndex() > 0);
  protected readonly hasNextPlayer = computed(
    () => this.selectedIndex() >= 0 && this.selectedIndex() < this.orderedPlayers().length - 1,
  );

  protected openPlayer(player: Player): void {
    this.selectedPlayerId.set(player.playerId);
  }

  protected closePlayer(): void {
    this.selectedPlayerId.set(null);
  }

  protected stepPlayer(offset: number): void {
    const player = this.orderedPlayers()[this.selectedIndex() + offset];
    if (player) this.selectedPlayerId.set(player.playerId);
  }

  protected recordMeterValues(t: Team): MeterItem[] {
    return [
      { label: 'W', value: t.wins, color: 'var(--p-green-500)' },
      { label: 'L', value: t.losses, color: 'var(--p-red-500)' },
      { label: 'T', value: t.ties, color: 'var(--p-surface-400)' },
    ];
  }

  protected recordMeterMax(t: Team): number {
    return t.wins + t.losses + t.ties || 1;
  }

  protected standingLabel(t: Team): string | null {
    if (!t.standingRank || !t.leagueSize) {
      return null;
    }
    return `${this.ordinal(t.standingRank)} of ${t.leagueSize}`;
  }

  protected readonly ordinal = ordinal;
}
