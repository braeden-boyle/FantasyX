import { Component, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, scan, startWith, switchMap } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { ChipModule } from 'primeng/chip';
import { DialogModule } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { PanelModule } from 'primeng/panel';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { TeamStateService } from '../../services/team-state.service';
import { EspnApiService } from '../../services/espn-api.service';
import { PlayerDetailService } from '../../services/player-detail.service';
import { TeamLogoComponent } from '../team-logo/team-logo.component';
import { PlayerAvatarComponent } from '../player-avatar/player-avatar.component';
import { ScoringBreakdownComponent } from '../scoring-breakdown/scoring-breakdown.component';
import { ImportTeamRequest, MatchupDetail, MatchupTeam, Player, PlayerDetail } from '../../models/team.model';
import {
  formatGameTime,
  shortStatus,
  sortStarters,
  statusLabel,
  statusSeverity,
} from '../../utils/player-format';

// One line of the head-to-head: the two players in the same lineup slot, either of which can be
// missing when one side has fewer players in that slot (or a shorter bench).
interface PairedRow {
  slot: string;
  left: Player | null;
  right: Player | null;
}

interface MatchupLoad {
  teamId: number;
  matchup: MatchupDetail | null;
  error: string | null;
  pending: boolean;
}

@Component({
  selector: 'app-matchup',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ButtonModule,
    ChipModule,
    DialogModule,
    MessageModule,
    PanelModule,
    ProgressSpinnerModule,
    SkeletonModule,
    TagModule,
    TeamLogoComponent,
    ScoringBreakdownComponent,
    PlayerAvatarComponent,
  ],
  templateUrl: './matchup.component.html',
  styleUrl: './matchup.component.css',
})
export class MatchupComponent {
  protected readonly teamState = inject(TeamStateService);
  private readonly espnApi = inject(EspnApiService);
  private readonly playerDetail = inject(PlayerDetailService);

  // Bound from the /matchup/:teamId route param; absent on plain /matchup, which means the user's own matchup.
  readonly teamId = input<string>();

  private readonly requestedTeamId = computed(() => {
    const id = this.teamId();
    return id === undefined ? this.teamState.myTeamId() : Number(id);
  });
  protected readonly isOwnMatchup = computed(() => this.requestedTeamId() === this.teamState.myTeamId());

  // Refetched on every visit and on Refresh, so live scores are never stale.
  private readonly reloadCount = signal(0);
  private readonly matchupRequest = computed<ImportTeamRequest | null>(() => {
    const request = this.teamState.importRequest();
    const teamId = this.requestedTeamId();
    if (!request || teamId === null) {
      return null;
    }
    this.reloadCount();
    return { ...request, teamId };
  });
  private readonly matchupLoad = toSignal(
    toObservable(this.matchupRequest).pipe(
      switchMap((request) =>
        request
          ? this.espnApi.getMatchup(request).pipe(
              map((matchup): MatchupLoad => ({ teamId: request.teamId, matchup, error: null, pending: false })),
              catchError((err) =>
                of<MatchupLoad>({
                  teamId: request.teamId,
                  matchup: null,
                  error: err?.error?.title ?? 'Could not load the matchup.',
                  pending: false,
                }),
              ),
              startWith<MatchupLoad>({ teamId: request.teamId, matchup: null, error: null, pending: true }),
            )
          : of(null),
      ),
      // A refresh of the same matchup keeps showing the current scores until the new ones arrive.
      scan((previous: MatchupLoad | null, current: MatchupLoad | null) =>
        current?.pending && previous?.matchup && previous.teamId === current.teamId
          ? { ...previous, pending: true }
          : current,
      null),
    ),
    { initialValue: null },
  );

  protected readonly loading = computed(() => {
    const load = this.matchupLoad();
    return this.matchupRequest() !== null && (load === null || (load.pending && !load.matchup));
  });
  protected readonly refreshing = computed(() => !!this.matchupLoad()?.pending);
  protected readonly errorMessage = computed(() => this.matchupLoad()?.error ?? null);
  protected readonly matchup = computed(() => this.matchupLoad()?.matchup ?? null);

  // Starters lined up slot by slot (RB1 vs RB1, RB2 vs RB2, ...), in standard lineup order.
  protected readonly starterRows = computed<PairedRow[]>(() => {
    const m = this.matchup();
    if (!m?.opponent) return [];
    const left = sortStarters(m.team.team.players);
    const right = sortStarters(m.opponent.team.players);
    const slots = [...new Set(sortStarters([...left, ...right]).map((p) => p.slot))];
    return slots.flatMap((slot) => {
      const lefts = left.filter((p) => p.slot === slot);
      const rights = right.filter((p) => p.slot === slot);
      return Array.from({ length: Math.max(lefts.length, rights.length) }, (_, i) => ({
        slot,
        left: lefts[i] ?? null,
        right: rights[i] ?? null,
      }));
    });
  });

  protected readonly benchRows = computed<PairedRow[]>(() => {
    const m = this.matchup();
    if (!m?.opponent) return [];
    const left = m.team.team.players.filter((p) => !p.starter);
    const right = m.opponent.team.players.filter((p) => !p.starter);
    return Array.from({ length: Math.max(left.length, right.length) }, (_, i) => ({
      slot: 'BN',
      left: left[i] ?? null,
      right: right[i] ?? null,
    }));
  });

  protected readonly statusSeverity = statusSeverity;
  protected readonly formatGameTime = formatGameTime;
  protected readonly shortStatus = shortStatus;
  protected readonly statusLabel = statusLabel;

  protected refresh(): void {
    this.reloadCount.update((n) => n + 1);
  }

  protected record(t: MatchupTeam): string {
    const { wins, losses, ties } = t.team;
    return ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
  }

  protected isLeading(side: MatchupTeam, other: MatchupTeam): boolean {
    return side.points > other.points;
  }

  // The user's own team links to plain /team so the My Team nav tab lights up.
  protected teamLink(teamId: number): string {
    return teamId === this.teamState.myTeamId() ? '/team' : `/team/${teamId}`;
  }

  protected startersProjected(t: MatchupTeam): number {
    return sortStarters(t.team.players).reduce((sum, p) => sum + p.projectedPoints, 0);
  }

  protected startersPoints(t: MatchupTeam): number {
    return sortStarters(t.team.players).reduce((sum, p) => sum + p.points, 0);
  }

  // Bold the side of a row that's outscoring the other, once either has points.
  protected isRowLeader(player: Player | null, other: Player | null): boolean {
    return !!player && player.points > (other?.points ?? 0);
  }

  // The player whose scoring breakdown the modal is showing, if any.
  protected readonly selectedPlayer = signal<Player | null>(null);
  private readonly breakdownReloadCount = signal(0);
  private readonly breakdownRequest = computed(() => {
    const player = this.selectedPlayer();
    return player ? { playerId: player.playerId, reload: this.breakdownReloadCount() } : null;
  });
  // Always refetched so live points match the row that was clicked.
  private readonly breakdownLoad = toSignal(
    toObservable(this.breakdownRequest).pipe(
      switchMap((request) =>
        request
          ? this.playerDetail.load(request.playerId, true).pipe(
              map((detail): { detail: PlayerDetail | null; error: string | null } => ({ detail, error: null })),
              catchError((err) =>
                of({ detail: null, error: err?.error?.title ?? 'Could not load the scoring breakdown.' }),
              ),
              startWith(null),
            )
          : of(null),
      ),
    ),
    { initialValue: null },
  );

  protected readonly breakdownLoading = computed(() => this.selectedPlayer() !== null && this.breakdownLoad() === null);
  protected readonly breakdownError = computed(() => this.breakdownLoad()?.error ?? null);
  protected readonly breakdownGame = computed(() => {
    const week = this.matchup()?.scoringPeriod;
    return this.breakdownLoad()?.detail?.games.find((g) => g.week === week) ?? null;
  });

  protected openPlayer(player: Player | null): void {
    if (player) this.selectedPlayer.set(player);
  }

  protected onDialogVisibleChange(visible: boolean): void {
    if (!visible) this.selectedPlayer.set(null);
  }

  protected retryBreakdown(): void {
    this.breakdownReloadCount.update((n) => n + 1);
  }

  protected opponentLabel(player: Player): string {
    return player.opponent ? `${player.opponentIsHome ? 'vs' : '@'} ${player.opponent}` : 'Bye';
  }
}
