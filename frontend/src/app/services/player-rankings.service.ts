import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { AvailablePlayersService } from './available-players.service';
import { LeagueOutlookService } from './league-outlook.service';
import { ProjectionsService } from './projections.service';
import { SettingsService } from './settings.service';
import { TeamStateService } from './team-state.service';
import { WeekMatchupsService } from './week-matchups.service';
import { AvailablePlayer, ImportTeamRequest } from '../models/team.model';
import {
  PlayerRankings,
  RankedPlayer,
  RankingHorizon,
  RankingsInput,
  buildPlayerRankings,
  startingPositions,
} from '../utils/player-rankings';

type AvailableLoad = { status: 'loading' } | { status: 'ready'; players: AvailablePlayer[] } | { status: 'failed' };

// loading     - still loading the league, rosters, projections or available players
// ready       - ranked (rosteredOnly when the available players failed)
// unavailable - the league, rosters or projections failed to load; nothing is ranked
// over        - the fantasy playoffs are over, so there's nothing left to rank
export type PlayerRankingsStatus = 'loading' | 'ready' | 'unavailable' | 'over';

type InputLoad = { status: 'loading' | 'unavailable' } | { status: 'ready'; input: RankingsInput };

// FantasyX's player rankings for the imported league, shared by the Players page, the player drawer
// and the roster view. Built from the league's slots (LeagueOutlookService), this week's rosters and
// every rostered player's history and upcoming projections (ProjectionsService), and the available
// players (AvailablePlayersService), all cached for the session. They follow the ESPN / FantasyX
// setting, and change with the scoring period, not with live scores. Nothing loads until a view
// calls ensureLoaded().
@Injectable({ providedIn: 'root' })
export class PlayerRankingsService {
  private readonly teamState = inject(TeamStateService);
  private readonly settings = inject(SettingsService);
  private readonly outlook = inject(LeagueOutlookService);
  private readonly projections = inject(ProjectionsService);
  private readonly weekMatchups = inject(WeekMatchupsService);
  private readonly availablePlayers = inject(AvailablePlayersService);

  private readonly wanted = signal(false);

  ensureLoaded(): void {
    this.outlook.ensureLoaded();
    this.projections.ensureLoaded();
    this.wanted.set(true);
  }

  // The available players are fetched for the league's starting positions once the league has
  // loaded, alongside the rosters' history rather than after it.
  private readonly availableRequest = computed<{ request: ImportTeamRequest; positions: string[] } | null>(
    () => {
      const request = this.teamState.importRequest();
      const league = this.outlook.league();
      return this.wanted() && request && league ? { request, positions: startingPositions(league.lineupSlots) } : null;
    },
    { equal: (a, b) => a === b || (!!a && !!b && a.request === b.request && a.positions.join() === b.positions.join()) },
  );

  private readonly availableLoad = toSignal(
    toObservable(this.availableRequest).pipe(
      switchMap((wanted) => {
        if (!wanted) return of(null);
        if (!wanted.positions.length) return of<AvailableLoad>({ status: 'ready', players: [] });
        return this.weekMatchups.load().pipe(
          switchMap((week) => this.availablePlayers.load(week.scoringPeriod, wanted.positions)),
          map((players): AvailableLoad => ({ status: 'ready', players })),
          catchError(() => of<AvailableLoad>({ status: 'failed' })),
          startWith<AvailableLoad>({ status: 'loading' }),
        );
      }),
    ),
    { initialValue: null },
  );

  private readonly input = computed<InputLoad>(() => {
    if (!this.wanted() || !this.teamState.importRequest()) return { status: 'loading' };
    // Without the rosters' upcoming projections there's nothing to rank on, in either mode, and
    // ESPN's figures are never shown under a FantasyX label.
    if (this.outlook.error() || this.projections.historyStatus() === 'failed') return { status: 'unavailable' };
    const league = this.outlook.league();
    const history = this.projections.loadedHistory();
    const available = this.availableLoad();
    if (!league || !history || !available || available.status === 'loading') return { status: 'loading' };
    if (!league.lineupSlots.length) return { status: 'unavailable' };
    return {
      status: 'ready',
      input: {
        league,
        week: history.week,
        histories: history.players,
        available: available.status === 'ready' ? available.players : null,
      },
    };
  });

  // Each ranking is only built when something reads it.
  private readonly built = {
    restOfSeason: this.build('restOfSeason'),
    week: this.build('week'),
  };

  private build(horizon: RankingHorizon) {
    return computed(() => {
      const load = this.input();
      return load.status === 'ready' ? buildPlayerRankings(load.input, this.settings.projectionSource(), horizon) : null;
    });
  }

  readonly status = computed<PlayerRankingsStatus>(() => {
    const load = this.input();
    if (load.status !== 'ready') return load.status;
    return this.built.restOfSeason() ? 'ready' : 'over';
  });

  // The rest-of-season ranking, which the drawer shows. Null until ready.
  readonly rankings = this.built.restOfSeason;

  // Either ranking, for the Players page's switch. Null until ready.
  rankingsFor(horizon: RankingHorizon): PlayerRankings | null {
    return this.built[horizon]();
  }

  private readonly byId = computed(
    () => new Map((this.rankings()?.players ?? []).map((p) => [p.playerId, p] as const)),
  );

  // A player's ranking, or undefined while loading or for a player outside the pool.
  rankOf(playerId: number): RankedPlayer | undefined {
    return this.byId().get(playerId);
  }
}
