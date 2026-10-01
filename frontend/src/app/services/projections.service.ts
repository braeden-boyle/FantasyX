import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { SettingsService } from './settings.service';
import { TeamStateService } from './team-state.service';
import { WeekMatchupsService } from './week-matchups.service';
import { PlayerHistoryService } from './player-history.service';
import { HistoryWeek, MatchupTeam, Player, PlayerDetail, PlayerGame, WeekMatchups } from '../models/team.model';
import { FantasyXModel, backtest, buildModel, residuals } from '../utils/projections';
import { ProjectionOf, ResidualsOf, espnProjection, teamOutlook } from '../utils/win-probability';

// What projection figures are showing:
//   espn        - ESPN's (the setting is ESPN)
//   loading     - FantasyX's are being built; figures read "—" until they are
//   ready       - FantasyX's
//   unavailable - FantasyX's couldn't be built (history failed to load); ESPN's are shown, with a note
export type ProjectionStatus = 'espn' | 'loading' | 'ready' | 'unavailable';

interface HistoryLoad {
  status: 'loading' | 'ready' | 'failed';
  week: WeekMatchups | null;
  histories: ReadonlyMap<number, HistoryWeek[]>;
  positions: ReadonlyMap<number, string>;
  model: FantasyXModel | null;
}

const LOADING: HistoryLoad = { status: 'loading', week: null, histories: new Map(), positions: new Map(), model: null };
const FAILED: HistoryLoad = { ...LOADING, status: 'failed' };

// The one place views read projections from, so every figure follows the ESPN / FantasyX setting
// together. FantasyX projections are built from the week's rostered players' history, loaded once
// per session (WeekMatchupsService and PlayerHistoryService cache it) and only when needed: in
// FantasyX mode, or when a view asks for it (win probability, the settings backtest).
@Injectable({ providedIn: 'root' })
export class ProjectionsService {
  private readonly settings = inject(SettingsService);
  private readonly teamState = inject(TeamStateService);
  private readonly weekMatchups = inject(WeekMatchupsService);
  private readonly playerHistory = inject(PlayerHistoryService);

  readonly source = this.settings.projectionSource;

  private readonly wanted = signal(false);
  private readonly historyRequest = computed(() => {
    const request = this.teamState.importRequest();
    return request && (this.source() === 'fantasyx' || this.wanted()) ? request : null;
  });

  private readonly load = toSignal(
    toObservable(this.historyRequest).pipe(
      switchMap((request) =>
        request
          ? this.weekMatchups.load().pipe(
              switchMap((week) =>
                this.playerHistory.load(week).pipe(
                  map((histories): HistoryLoad => {
                    const positions = new Map(
                      week.teams.flatMap((t) => t.team.players.map((p) => [p.playerId, p.position] as const)),
                    );
                    return { status: 'ready', week, histories, positions, model: buildModel(histories, positions) };
                  }),
                ),
              ),
              catchError(() => of(FAILED)),
              startWith(LOADING),
            )
          : of(null),
      ),
    ),
    { initialValue: null },
  );

  // State of the history behind FantasyX projections and win probability's spreads.
  readonly historyStatus = computed(() => this.load()?.status ?? 'idle');

  readonly status = computed<ProjectionStatus>(() => {
    if (this.source() === 'espn') return 'espn';
    const status = this.historyStatus();
    return status === 'ready' ? 'ready' : status === 'failed' ? 'unavailable' : 'loading';
  });

  // Whether figures are FantasyX's right now.
  readonly fantasyX = computed(() => this.status() === 'ready');

  // In multi-week playoff rounds player projections only cover one week, so team totals stay ESPN's.
  readonly multiWeek = computed(() => (this.load()?.week?.scoringPeriodsInMatchup ?? 1) > 1);

  readonly backtest = computed(() => {
    const load = this.load();
    return load?.status === 'ready' ? backtest(load.histories, load.positions) : null;
  });

  // Loads the history even in ESPN mode, for views that need it either way.
  ensureLoaded(): void {
    this.wanted.set(true);
  }

  // The active source's projection for a player's week: a function, for win probability.
  readonly projectionOf = computed<ProjectionOf>(() => {
    const load = this.load();
    if (!this.fantasyX() || !load?.model || !load.week) return espnProjection;
    const { model, week } = load;
    return (p: Player) =>
      model.project(p.playerId, p.position, week.scoringPeriod, p.projectedPoints, p.opponentPositionRank);
  });

  // Each player's misses against the active source, or null until the history has loaded.
  readonly residualsOf = computed<ResidualsOf | null>(() => {
    const load = this.load();
    if (load?.status !== 'ready') return null;
    const model = this.fantasyX() ? load.model : null;
    return (playerId: number) => {
      const weeks = load.histories.get(playerId);
      return weeks && residuals(playerId, load.positions.get(playerId) ?? '', weeks, model);
    };
  });

  // The active source's projection for a player in a past week, from their history: 0 for a week
  // they didn't play. For power rankings' movement (last week's roster strength). Null until the
  // history has loaded.
  readonly pastProjectionOf = computed<((player: Player, week: number) => number) | null>(() => {
    const load = this.load();
    if (load?.status !== 'ready') return null;
    const model = this.fantasyX() ? load.model : null;
    return (p: Player, week: number) => {
      const played = load.histories.get(p.playerId)?.find((w) => w.week === week);
      if (!played) return 0;
      return model
        ? model.project(p.playerId, p.position, week, played.projected, played.opponentPositionRank)
        : played.projected;
    };
  });

  // A team's roster and score from the week the projections were built from.
  weekTeam(teamId: number): MatchupTeam | undefined {
    return this.load()?.week?.teams.find((t) => t.team.teamId === teamId);
  }

  // A player's projection this week, or null while FantasyX's are loading.
  projected(player: Player): number | null {
    if (this.status() === 'loading') return null;
    return this.projectionOf()(player);
  }

  // A side's projected final score: ESPN's total, or in FantasyX mode points so far plus what its
  // starters have left (the same expected score win probability uses). points overrides the side's
  // own, e.g. with fresher scores from the league view. Null while loading or when unknown.
  teamTotal(side: MatchupTeam | undefined, espnTotal: number | null, now: Date, points?: number): number | null {
    const status = this.status();
    if (status === 'loading') return null;
    if (status !== 'ready' || this.multiWeek()) return espnTotal;
    if (!side) return null;
    return teamOutlook({ ...side, points: points ?? side.points }, this.projectionOf(), null, now).expected;
  }

  // The player drawer's projection for one of their games. Past weeks show what FantasyX would
  // have projected at the time. Null for a bye, or while FantasyX's are loading.
  gameProjection(detail: PlayerDetail, game: PlayerGame): number | null {
    const status = this.status();
    if (status === 'loading') return null;
    const model = this.load()?.model;
    if (status !== 'ready' || !model || game.projectedPoints === null) return game.projectedPoints;
    return model.project(detail.playerId, detail.position, game.week, game.projectedPoints, game.opponentPositionRank);
  }
}
