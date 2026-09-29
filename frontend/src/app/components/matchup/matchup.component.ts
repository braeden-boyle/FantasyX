import { Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
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
import { TooltipModule } from 'primeng/tooltip';
import { TeamStateService } from '../../services/team-state.service';
import { WeekMatchupsService } from '../../services/week-matchups.service';
import { PlayerDetailService } from '../../services/player-detail.service';
import { PlayerSpreadsService } from '../../services/player-spreads.service';
import { TeamLogoComponent } from '../team-logo/team-logo.component';
import { PlayerAvatarComponent } from '../player-avatar/player-avatar.component';
import { ScoringBreakdownComponent } from '../scoring-breakdown/scoring-breakdown.component';
import {
  Matchup,
  MatchupDetail,
  MatchupTeam,
  Player,
  PlayerDetail,
  PlayerSpread,
  WeekMatchups,
} from '../../models/team.model';
import { involves, mineFirst } from '../../utils/league-format';
import { barShare, barTone, formatChance, winProbability } from '../../utils/win-probability';
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

// null spreads with failed set means the request failed and position defaults stand in.
interface SpreadsLoad {
  spreads: ReadonlyMap<number, PlayerSpread> | null;
  failed: boolean;
}

interface WeekLoad {
  week: WeekMatchups | null;
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
    TooltipModule,
    TeamLogoComponent,
    ScoringBreakdownComponent,
    PlayerAvatarComponent,
  ],
  templateUrl: './matchup.component.html',
  styleUrl: './matchup.component.css',
})
export class MatchupComponent {
  protected readonly teamState = inject(TeamStateService);
  private readonly weekMatchupsService = inject(WeekMatchupsService);
  private readonly playerDetail = inject(PlayerDetailService);
  private readonly playerSpreads = inject(PlayerSpreadsService);
  private readonly router = inject(Router);

  // Bound from the /matchup/:teamId route param; absent on plain /matchup, which means the user's own matchup.
  readonly teamId = input<string>();

  private readonly requestedTeamId = computed(() => {
    const id = this.teamId();
    return id === undefined ? this.teamState.myTeamId() : Number(id);
  });

  // The whole week is loaded once and cached (WeekMatchupsService), so switching matchups is
  // instant. Only Refresh refetches it; it also drops cached player breakdowns so they match.
  private readonly reloadCount = signal(0);
  private forceNextLoad = false;
  private readonly weekRequest = computed(() => {
    const request = this.teamState.importRequest();
    return request ? { request, reload: this.reloadCount() } : null;
  });
  private readonly weekLoad = toSignal(
    toObservable(this.weekRequest).pipe(
      switchMap((weekRequest) => {
        if (!weekRequest) return of(null);
        const force = this.forceNextLoad;
        this.forceNextLoad = false;
        return this.weekMatchupsService.load(force).pipe(
          map((week): WeekLoad => ({ week, error: null, pending: false })),
          catchError((err) =>
            of<WeekLoad>({ week: null, error: err?.error?.title ?? 'Could not load the matchups.', pending: false }),
          ),
          startWith<WeekLoad>({ week: null, error: null, pending: true }),
        );
      }),
      // A refresh keeps showing the current scores until the new ones arrive.
      scan(
        (previous: WeekLoad | null, current: WeekLoad | null) =>
          current?.pending && previous?.week ? { ...previous, pending: true } : current,
        null,
      ),
    ),
    { initialValue: null },
  );

  private readonly week = computed(() => this.weekLoad()?.week ?? null);
  private readonly teamsById = computed(
    () => new Map((this.week()?.teams ?? []).map((t) => [t.team.teamId, t] as const)),
  );

  protected readonly matchup = computed<MatchupDetail | null>(() => {
    const week = this.week();
    const teamId = this.requestedTeamId();
    const team = teamId === null ? undefined : this.teamsById().get(teamId);
    if (!week || !team) return null;
    const pair = week.matchups.find((p) => p.homeTeamId === teamId || p.awayTeamId === teamId);
    const opponentId = !pair ? null : pair.homeTeamId === teamId ? pair.awayTeamId : pair.homeTeamId;
    return {
      leagueName: week.leagueName,
      matchupPeriod: week.matchupPeriod,
      scoringPeriod: week.scoringPeriod,
      team,
      opponent: opponentId === null ? null : (this.teamsById().get(opponentId) ?? null),
    };
  });

  // Each player's week-to-week swing, loaded once per week (not on Refresh) for the win probability.
  private readonly spreadsLoad = toSignal(
    toObservable(this.week).pipe(
      switchMap((week) =>
        week
          ? this.playerSpreads.load(week).pipe(
              map((spreads): SpreadsLoad => ({ spreads, failed: false })),
              catchError(() => of<SpreadsLoad>({ spreads: null, failed: true })),
              startWith(null),
            )
          : of(null),
      ),
    ),
    { initialValue: null },
  );
  protected readonly spreadsFailed = computed(() => !!this.spreadsLoad()?.failed);

  // When the scores were fetched, so in-progress games are judged against the same moment.
  private readonly scoresAsOf = computed(() => {
    this.week();
    return new Date();
  });

  // Hidden on byes and in multi-week playoff rounds, where player projections only cover one week
  // but the matchup totals cover the whole round.
  protected readonly showWinChance = computed(() => {
    const m = this.matchup();
    return !!m?.opponent && (this.week()?.scoringPeriodsInMatchup ?? 1) <= 1;
  });
  protected readonly winChance = computed(() => {
    const m = this.matchup();
    const load = this.spreadsLoad();
    if (!this.showWinChance() || !m?.opponent || !load) return null;
    return winProbability(m.team, m.opponent, load.spreads, this.scoresAsOf());
  });
  protected readonly barTone = barTone;
  protected readonly barShare = barShare;
  protected readonly formatChance = formatChance;

  protected readonly loading = computed(() => {
    const load = this.weekLoad();
    return this.weekRequest() !== null && (load === null || (load.pending && !load.week));
  });
  protected readonly refreshing = computed(() => !!this.weekLoad()?.pending);
  protected readonly errorMessage = computed(() => {
    const error = this.weekLoad()?.error;
    if (error) return error;
    return this.week() && !this.matchup() ? `Team ${this.teamId()} isn't in this league.` : null;
  });

  // The week's head-to-head matchups (byes left out) for the switcher above the scoreboard.
  protected readonly weekMatchups = computed<Matchup[]>(() => {
    const side = (teamId: number) => {
      const t = this.teamsById().get(teamId);
      return { teamId, points: t?.points ?? 0, projectedPoints: t?.projectedPoints ?? null };
    };
    const matchups = (this.week()?.matchups ?? [])
      .filter((p) => p.awayTeamId !== null)
      .map((p) => ({ home: side(p.homeTeamId), away: side(p.awayTeamId!) }));
    return mineFirst(matchups, this.teamState.myTeamId());
  });
  protected readonly currentIndex = computed(() =>
    this.weekMatchups().findIndex((m) => involves(m, this.requestedTeamId())),
  );
  protected readonly previousMatchup = computed(() => this.weekMatchups()[this.currentIndex() - 1] ?? null);
  protected readonly nextMatchup = computed(() => {
    const index = this.currentIndex();
    return index < 0 ? null : (this.weekMatchups()[index + 1] ?? null);
  });

  private readonly switcher = viewChild<ElementRef<HTMLElement>>('switcher');

  constructor() {
    // Keep the current matchup's chip in view as the user steps through them.
    effect(() => {
      const index = this.currentIndex();
      const switcher = this.switcher()?.nativeElement;
      if (!switcher || index < 0) return;
      setTimeout(() =>
        switcher
          .querySelector('[aria-current="page"]')
          ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }),
      );
    });
  }

  protected teamSide(teamId: number): MatchupTeam | undefined {
    return this.teamsById().get(teamId);
  }

  protected isCurrentMatchup(m: Matchup): boolean {
    return involves(m, this.requestedTeamId());
  }

  protected isMyMatchup(m: Matchup): boolean {
    return involves(m, this.teamState.myTeamId());
  }

  // The user's own matchup links to plain /matchup so the Matchup nav tab lights up.
  protected matchupLink(m: Matchup): string {
    return this.isMyMatchup(m) ? '/matchup' : `/matchup/${m.home.teamId}`;
  }

  protected goToMatchup(m: Matchup | null): void {
    if (m) this.router.navigateByUrl(this.matchupLink(m));
  }

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
    this.forceNextLoad = true;
    this.playerDetail.clear();
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
  // Cached like the matchup itself, so it matches the row until the next Refresh.
  private readonly breakdownLoad = toSignal(
    toObservable(this.breakdownRequest).pipe(
      switchMap((request) =>
        request
          ? this.playerDetail.load(request.playerId).pipe(
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
