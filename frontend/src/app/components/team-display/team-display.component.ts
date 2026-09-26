import { Component, computed, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { AvatarModule } from 'primeng/avatar';
import { ChipModule } from 'primeng/chip';
import { MeterGroupModule, MeterItem } from 'primeng/metergroup';
import { RatingModule } from 'primeng/rating';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { TeamStateService } from '../../services/team-state.service';
import { EspnApiService } from '../../services/espn-api.service';
import { ImportTeamRequest, Player, Team } from '../../models/team.model';
import { PlayerDetailDrawerComponent } from '../player-detail-drawer/player-detail-drawer.component';
import { formatGameTime, matchupStars, statusSeverity } from '../../utils/player-format';

const STARTER_SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'D/ST', 'K'];

@Component({
  selector: 'app-team-display',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TableModule,
    TagModule,
    AvatarModule,
    ChipModule,
    MeterGroupModule,
    RatingModule,
    ProgressSpinnerModule,
    MessageModule,
    ButtonModule,
    PlayerDetailDrawerComponent,
  ],
  templateUrl: './team-display.component.html',
  styleUrl: './team-display.component.css',
})
export class TeamDisplayComponent {
  protected readonly teamState = inject(TeamStateService);
  private readonly espnApi = inject(EspnApiService);

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

  protected retry(): void {
    this.reloadCount.update((n) => n + 1);
  }

  protected readonly starters = computed<Player[]>(() =>
    [...(this.team()?.players ?? [])]
      .filter((p) => p.starter)
      .sort((a, b) => STARTER_SLOT_ORDER.indexOf(a.slot) - STARTER_SLOT_ORDER.indexOf(b.slot)),
  );
  protected readonly bench = computed<Player[]>(() => (this.team()?.players ?? []).filter((p) => !p.starter));

  protected readonly startersProjectedTotal = computed(() =>
    this.starters().reduce((sum, p) => sum + p.projectedPoints, 0),
  );
  protected readonly startersPointsTotal = computed(() => this.starters().reduce((sum, p) => sum + p.points, 0));

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

  private ordinal(n: number): string {
    const suffixes: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };
    const isTeens = n % 100 >= 11 && n % 100 <= 13;
    return `${n}${isTeens ? 'th' : (suffixes[n % 10] ?? 'th')}`;
  }
}
