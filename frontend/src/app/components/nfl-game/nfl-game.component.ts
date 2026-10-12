import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, fromEvent, map, of, scan, startWith, switchMap } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TabsModule } from 'primeng/tabs';
import { TagModule } from 'primeng/tag';
import { TeamStateService } from '../../services/team-state.service';
import { WeekMatchupsService } from '../../services/week-matchups.service';
import { LoadedNflGame, NflGameService } from '../../services/nfl-game.service';
import { ProjectionsService } from '../../services/projections.service';
import { NflTeamMarkComponent } from '../nfl-team-mark/nfl-team-mark.component';
import { ProjectionSourceComponent } from '../projection-source/projection-source.component';
import { NflGamesStripComponent, StripSide } from '../nfl-games-strip/nfl-games-strip.component';
import {
  MatchupTeam,
  NflBoxScoreTeam,
  NflFantasyPlayer,
  NflGame,
  NflGameTeam,
  NflPlay,
  Player,
} from '../../models/team.model';
import { GAME_REFRESH_INTERVAL_MS, nextRefreshDelay } from '../../utils/live-refresh';
import { formatGameTime, shortStatus, sortStarters, statusLabel, statusSeverity } from '../../utils/player-format';
import { NflGamePhase, nflGamePhase, periodName, periodShort, teamFieldState, winner } from '../../utils/nfl-games';

// silentFailure marks a failed automatic refresh, which keeps the game already on screen.
interface GameLoad {
  eventId: string;
  loaded: LoadedNflGame | null;
  error: string | null;
  pending: boolean;
  silentFailure?: boolean;
}

// Which side of the matchup this page was opened from rosters a player: 'team' is the side the
// matchup is viewed from (the user's own, unless ?team= names another), 'opponent' the other.
type OwnerSide = 'team' | 'opponent';

interface Owner {
  side: OwnerSide;
  starter: boolean;
  teamName: string;
}

// A row of the top fantasy players: the player, and which side of the matchup rosters them, if either.
interface FantasyRow {
  player: NflFantasyPlayer;
  projected: number | null;
  owner: Owner | null;
}

// How many of the top fantasy players show before "Show all".
const TOP_PLAYERS = 10;

const CATEGORY_TITLES: Record<string, string> = {
  passing: 'Passing',
  rushing: 'Rushing',
  receiving: 'Receiving',
  kicking: 'Kicking',
};

// Box score columns left out as noise for fantasy (quarterback rating, kicking percentage).
const HIDDEN_COLUMNS: Record<string, string[]> = {
  passing: ['QBR', 'RTG'],
  kicking: ['PCT'],
};

// One NFL game: the score by quarter, the last play, both teams' top fantasy players under the
// league's scoring, the team stats, the box score and the scoring summary. Opened from the strip of
// the week's games above the matchup scoreboard, and refreshed every 30 seconds while the game is on.
@Component({
  selector: 'app-nfl-game',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ButtonModule,
    MessageModule,
    ProgressSpinnerModule,
    TabsModule,
    TagModule,
    NflTeamMarkComponent,
    ProjectionSourceComponent,
    NflGamesStripComponent,
  ],
  templateUrl: './nfl-game.component.html',
  styleUrl: './nfl-game.component.css',
})
export class NflGameComponent {
  protected readonly teamState = inject(TeamStateService);
  private readonly weekMatchupsService = inject(WeekMatchupsService);
  private readonly nflGameService = inject(NflGameService);
  protected readonly projections = inject(ProjectionsService);
  private readonly document = inject(DOCUMENT);

  // Bound from the :gameId route param.
  readonly gameId = input.required<string>();
  // Bound from the ?team= query param: the fantasy team whose matchup this page was opened from.
  // Absent for the user's own matchup.
  readonly team = input<string>();

  private readonly contextTeamId = computed(() => {
    const team = this.team();
    return team === undefined ? this.teamState.myTeamId() : Number(team);
  });

  protected readonly backLink = computed(() => (this.team() === undefined ? '/matchup' : `/matchup/${this.team()}`));

  // The cached week of matchups: its scoring period scores the game's players, and its games and
  // rosters fill the strip.
  private readonly weekLoad = toSignal(
    toObservable(this.teamState.importRequest).pipe(
      switchMap((request) =>
        !request
          ? of(null)
          : this.weekMatchupsService.load().pipe(
              map((week) => ({ week, error: null as string | null })),
              catchError((err) => of({ week: null, error: err?.error?.title ?? 'Could not load the week.' })),
              startWith(null),
            ),
      ),
    ),
    { initialValue: null },
  );
  private readonly week = computed(() => this.weekLoad()?.week ?? null);

  private readonly reloadCount = signal(0);
  private forceNextLoad = false;
  private silentNextLoad = false;
  // When an automatic refresh last failed, so the next attempt waits a full interval.
  private readonly autoRefreshFailedAt = signal<Date | null>(null);

  private readonly gameRequest = computed(() => {
    const week = this.week();
    return week ? { eventId: this.gameId(), scoringPeriod: week.scoringPeriod, reload: this.reloadCount() } : null;
  });
  private readonly gameLoad = toSignal(
    toObservable(this.gameRequest).pipe(
      switchMap((request) => {
        if (!request) return of(null);
        const { eventId, scoringPeriod } = request;
        const force = this.forceNextLoad;
        const silent = this.silentNextLoad;
        this.forceNextLoad = false;
        this.silentNextLoad = false;
        return this.nflGameService.load(eventId, scoringPeriod, force).pipe(
          map((loaded): GameLoad => ({ eventId, loaded, error: null, pending: false })),
          catchError((err) => {
            if (silent) {
              this.autoRefreshFailedAt.set(new Date());
              return of<GameLoad>({ eventId, loaded: null, error: null, pending: false, silentFailure: true });
            }
            return of<GameLoad>({
              eventId,
              loaded: null,
              error: err?.error?.title ?? 'Could not load the game.',
              pending: false,
            });
          }),
          startWith<GameLoad>({ eventId, loaded: null, error: null, pending: true }),
        );
      }),
      // A refresh keeps the game on screen until the new one arrives, and a failed automatic refresh
      // keeps it (it's retried later). Switching to another game starts clean.
      scan((previous: GameLoad | null, current: GameLoad | null) => {
        if (!current || !previous?.loaded || previous.eventId !== current.eventId) return current;
        if (current.pending) return { ...previous, pending: true };
        if (current.silentFailure) return { ...previous, pending: false };
        return current;
      }, null),
    ),
    { initialValue: null },
  );

  protected readonly detail = computed(() => this.gameLoad()?.loaded?.detail ?? null);
  private readonly fetchedAt = computed(() => this.gameLoad()?.loaded?.fetchedAt ?? new Date());

  protected readonly loading = computed(() => {
    if (!this.teamState.importRequest()) return false;
    const week = this.weekLoad();
    if (week === null) return true;
    if (week.error) return false;
    const load = this.gameLoad();
    return load === null || (load.pending && !load.loaded);
  });
  protected readonly refreshing = computed(() => !!this.gameLoad()?.pending);
  protected readonly errorMessage = computed(() => this.weekLoad()?.error ?? this.gameLoad()?.error ?? null);

  // The strip's games, with this one swapped for the fresher copy loaded here.
  protected readonly stripGames = computed<NflGame[]>(() => {
    const games = this.week()?.nflGames ?? [];
    const game = this.detail()?.game;
    return game ? games.map((g) => (g.eventId === game.eventId ? game : g)) : games;
  });
  protected readonly teamsOnBye = computed(() => this.week()?.teamsOnBye ?? []);
  protected readonly stripAsOf = computed(() => {
    this.week();
    return this.weekMatchupsService.fetchedAt() ?? new Date();
  });
  protected readonly stripLinkTeam = computed(() => (this.team() === undefined ? null : Number(this.team())));

  // The two sides of the matchup this page was opened from, or none (a bye, or not in the week).
  private readonly matchupSides = computed<MatchupTeam[]>(() => {
    const week = this.week();
    const teamId = this.contextTeamId();
    if (!week || teamId === null) return [];
    const pair = week.matchups.find((p) => p.homeTeamId === teamId || p.awayTeamId === teamId);
    if (!pair || pair.awayTeamId === null) return [];
    const opponentId = pair.homeTeamId === teamId ? pair.awayTeamId : pair.homeTeamId;
    const byId = new Map(week.teams.map((t) => [t.team.teamId, t] as const));
    const sides = [byId.get(teamId), byId.get(opponentId)];
    return sides.every((s) => s) ? (sides as MatchupTeam[]) : [];
  });
  // "Back to GURU vs SCAR", or plain "Back to matchup" until the week loads (or on a bye).
  protected readonly backLabel = computed(() => {
    const [team, opponent] = this.matchupSides();
    return team && opponent ? `Back to ${team.team.abbrev} vs ${opponent.team.abbrev}` : 'Back to matchup';
  });

  protected readonly stripSides = computed<StripSide[]>(() =>
    this.matchupSides().map((side) => ({ abbrev: side.team.abbrev, starters: sortStarters(side.team.players) })),
  );

  // Every rostered player in the league, so a rostered player's projection follows the active source.
  private readonly rosteredById = computed(
    () => new Map((this.week()?.teams ?? []).flatMap((t) => t.team.players.map((p) => [p.playerId, p] as const))),
  );

  // Every player on either side of the matchup, starters and bench, by player id.
  private readonly owners = computed(() => {
    const owners = new Map<number, Owner>();
    this.matchupSides().forEach((side, i) => {
      for (const p of side.team.players) {
        owners.set(p.playerId, { side: i === 0 ? 'team' : 'opponent', starter: p.starter, teamName: side.team.name });
      }
    });
    return owners;
  });

  // What the two dot colours mean: "Your players" and "Opponent's players" from the user's own
  // matchup, or the two teams' names from someone else's. Null when there's no matchup to colour by.
  protected readonly legend = computed<Record<OwnerSide, string> | null>(() => {
    const [team, opponent] = this.matchupSides();
    if (!team || !opponent) return null;
    return this.team() === undefined
      ? { team: 'Your players', opponent: "Opponent's players" }
      : { team: team.team.name, opponent: opponent.team.name };
  });

  protected ownerOf(playerId: number | null): Owner | null {
    return playerId === null ? null : (this.owners().get(playerId) ?? null);
  }

  // The owner dot's text for screen readers and its tooltip, since the colour alone carries it.
  protected ownerLabel(owner: Owner): string {
    return `${owner.starter ? 'Starting' : 'On the bench'} for ${owner.teamName}`;
  }

  private readonly fantasyRows = computed<FantasyRow[] | null>(() => {
    const players = this.detail()?.fantasyPlayers;
    if (!players) return null;
    return players.map((player) => ({
      player,
      projected: this.projections.projected(this.rosteredById().get(player.playerId) ?? this.asPlayer(player)),
      owner: this.ownerOf(player.playerId),
    }));
  });
  protected readonly showAllPlayers = signal(false);
  protected readonly visibleFantasyRows = computed(() => {
    const rows = this.fantasyRows();
    return rows && !this.showAllPlayers() ? rows.slice(0, TOP_PLAYERS) : rows;
  });
  protected readonly hiddenPlayerCount = computed(() => Math.max(0, (this.fantasyRows()?.length ?? 0) - TOP_PLAYERS));

  // The box score team showing; null shows the first (away) team.
  protected readonly boxTeam = signal<string | null>(null);

  protected readonly scoringByQuarter = computed(() => {
    const groups: { period: number | null; plays: NflPlay[] }[] = [];
    for (const play of this.detail()?.scoringPlays ?? []) {
      const last = groups[groups.length - 1];
      if (last && last.period === play.period) last.plays.push(play);
      else groups.push({ period: play.period, plays: [play] });
    }
    return groups;
  });

  // Q1..Q4 and any overtime, as many columns as either team has scores for.
  protected readonly linescoreColumns = computed(() => {
    const game = this.detail()?.game;
    const count = Math.max(game?.away.linescores.length ?? 0, game?.home.linescores.length ?? 0);
    return Array.from({ length: count }, (_, i) => periodShort(i + 1));
  });

  // The last time a team scored, shown on the card once the game is over.
  protected readonly lastScore = computed(() => this.detail()?.scoringPlays.at(-1) ?? null);

  // Automatic refreshes pause while the tab is hidden.
  private readonly pageVisible = toSignal(
    fromEvent(this.document, 'visibilitychange').pipe(map(() => this.document.visibilityState === 'visible')),
    { initialValue: this.document.visibilityState === 'visible' },
  );

  constructor() {
    // Refetch every 30 seconds while the game is on, and shortly after kickoff before it starts. A
    // refresh that's overdue (reopening a cached live game, or the tab shown again) happens right away.
    effect((onCleanup) => {
      const load = this.gameLoad();
      if (!load?.loaded || load.pending || !this.pageVisible()) return;
      const { detail, fetchedAt } = load.loaded;
      const failedAt = this.autoRefreshFailedAt();
      const lastAttempt = failedAt && failedAt > fetchedAt ? failedAt : fetchedAt;
      const delay = nextRefreshDelay([], lastAttempt, new Date(), [detail.game], GAME_REFRESH_INTERVAL_MS);
      if (delay === null) return;
      const timer = setTimeout(() => this.autoRefresh(), delay);
      onCleanup(() => clearTimeout(timer));
    });

    // A different game starts on its first box score team, with the list of players collapsed.
    effect(() => {
      this.gameId();
      this.boxTeam.set(null);
      this.showAllPlayers.set(false);
    });
  }

  protected refresh(): void {
    this.forceNextLoad = true;
    this.reloadCount.update((n) => n + 1);
  }

  private autoRefresh(): void {
    this.silentNextLoad = true;
    this.refresh();
  }

  protected phase(game: NflGame): NflGamePhase {
    return nflGamePhase(game, this.fetchedAt());
  }

  protected fieldState(game: NflGame, team: NflGameTeam) {
    return teamFieldState(game, team, this.fetchedAt());
  }

  protected isWinner(game: NflGame, team: NflGameTeam): boolean {
    return winner(game, this.fetchedAt()) === team;
  }

  // The team with the ball while live, for the header's situation line.
  protected possessionTeam(game: NflGame): NflGameTeam | null {
    return [game.away, game.home].find((t) => t.abbrev === game.possessionTeam) ?? null;
  }

  protected boxScoreFor(teams: NflBoxScoreTeam[]): NflBoxScoreTeam | undefined {
    const selected = this.boxTeam();
    return teams.find((t) => t.teamAbbrev === selected) ?? teams[0];
  }

  // The indexes of a category's columns worth showing.
  protected visibleColumns(category: NflBoxScoreTeam['categories'][number]): number[] {
    const hidden = HIDDEN_COLUMNS[category.name] ?? [];
    return category.labels.map((_, i) => i).filter((i) => !hidden.includes(category.labels[i]));
  }

  protected categoryTitle(name: string): string {
    return CATEGORY_TITLES[name] ?? name;
  }

  protected playClock(play: NflPlay): string {
    return [periodShort(play.period), play.clock].filter((part) => part).join(' ');
  }

  protected readonly periodName = periodName;
  protected readonly formatGameTime = formatGameTime;
  protected readonly statusSeverity = statusSeverity;
  protected readonly shortStatus = shortStatus;
  protected readonly statusLabel = statusLabel;

  // A non-rostered player in the shape projections take. With no history the FantasyX model leaves
  // ESPN's projection unchanged, the honest answer for a player it knows nothing about.
  private asPlayer(player: NflFantasyPlayer): Player {
    return {
      ...player,
      slot: player.position,
      starter: false,
      projectedPoints: player.projectedPoints ?? 0,
      opponent: null,
      opponentIsHome: null,
      gameTimeUtc: null,
      opponentPositionRank: null,
      gameFinal: false,
      gameState: null,
      gameDetail: null,
      possessionTeam: null,
      redZone: false,
    };
  }
}
