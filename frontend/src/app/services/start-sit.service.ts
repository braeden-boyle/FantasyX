import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, scan, startWith, switchMap } from 'rxjs';
import { LeagueOutlookService } from './league-outlook.service';
import { PlayerRankingsService } from './player-rankings.service';
import { ProjectionsService } from './projections.service';
import { TeamStateService } from './team-state.service';
import { WeekMatchupsService } from './week-matchups.service';
import { MatchupTeam, WeekMatchups } from '../models/team.model';
import { StartSitAdvice, startSitAdvice } from '../utils/start-sit';
import { winProbability } from '../utils/win-probability';

// How often locks are re-checked against the clock, so a player locks at kickoff without a refetch.
const CLOCK_TICK_MS = 60 * 1000;

interface WeekLoad {
  week: WeekMatchups | null;
  error: string | null;
  pending: boolean;
}

// loading - the week, league or projections are still loading
// error - the week failed to load (message in error)
// unavailable - the league's lineup settings failed to load, or it has none
// ready - advice is built
export type StartSitStatus = 'idle' | 'loading' | 'error' | 'unavailable' | 'ready';

// Your chance of winning this week's matchup with the set lineup and with the suggested one. Null
// on a bye week, and when the matchup spans more than one NFL week (projections cover this week).
export interface WinChange {
  before: number;
  after: number;
}

// Start/sit advice for your own team this week (docs/PLAN.md, v1.12). The Advice page refreshes the
// week on each visit, since you may have just changed your lineup on ESPN; the roster hint reads the
// cached week.
@Injectable({ providedIn: 'root' })
export class StartSitService {
  private readonly teamState = inject(TeamStateService);
  private readonly weekMatchups = inject(WeekMatchupsService);
  private readonly outlook = inject(LeagueOutlookService);
  private readonly projections = inject(ProjectionsService);
  private readonly rankingsService = inject(PlayerRankingsService);

  private readonly wanted = signal(false);
  private readonly reloads = signal(0);
  private forceNext = false;

  private readonly clock = signal(new Date());
  private clockRunning = false;

  // Loads the advice from the cached week, if it isn't already (the roster hint).
  ensureLoaded(): void {
    this.outlook.ensureLoaded();
    this.wanted.set(true);
    this.startClock();
  }

  // Refetches the week (the Advice page, on each visit and on Refresh). The advice already on screen
  // stays until the new week arrives.
  refresh(): void {
    this.forceNext = true;
    this.reloads.update((n) => n + 1);
    this.ensureLoaded();
  }

  // Retry after a failure: the league again if its lineup settings failed, and the week either way.
  retry(): void {
    if (this.outlook.error()) this.outlook.refresh();
    this.refresh();
  }

  // The weekly position ranks beside each player ("WR14 this week"). Loads the available players,
  // so only the Advice page asks for it.
  loadRanks(): void {
    this.rankingsService.ensureLoaded();
  }

  private startClock(): void {
    if (this.clockRunning) return;
    this.clockRunning = true;
    setInterval(() => this.clock.set(new Date()), CLOCK_TICK_MS);
  }

  private readonly weekRequest = computed(() => {
    const request = this.teamState.importRequest();
    if (!request || !this.wanted()) return null;
    return { request, reload: this.reloads() };
  });

  private readonly weekLoad = toSignal(
    toObservable(this.weekRequest).pipe(
      switchMap((weekRequest) => {
        if (!weekRequest) return of(null);
        const force = this.forceNext;
        this.forceNext = false;
        return this.weekMatchups.load(force).pipe(
          map((week): WeekLoad => ({ week, error: null, pending: false })),
          catchError((err) =>
            of<WeekLoad>({ week: null, error: err?.error?.title ?? 'Could not load this week’s lineups.', pending: false }),
          ),
          startWith<WeekLoad>({ week: null, error: null, pending: true }),
        );
      }),
      // A refresh keeps the advice on screen until the new week arrives.
      scan((previous: WeekLoad | null, current: WeekLoad | null) => {
        if (current?.pending && previous?.week) return { ...previous, pending: true };
        return current;
      }, null),
    ),
    { initialValue: null },
  );

  readonly refreshing = computed(() => this.weekLoad()?.pending ?? false);
  readonly error = computed(() => this.weekLoad()?.error ?? null);
  private readonly week = computed(() => this.weekLoad()?.week ?? null);
  readonly scoringPeriod = computed(() => this.week()?.scoringPeriod ?? null);

  // Your team and this week's opponent (null on a bye), from the loaded week.
  readonly side = computed<{ team: MatchupTeam; opponent: MatchupTeam | null } | null>(() => {
    const week = this.week();
    const teamId = this.teamState.myTeamId();
    const team = week?.teams.find((t) => t.team.teamId === teamId);
    if (!week || !team) return null;
    const pair = week.matchups.find((m) => m.homeTeamId === teamId || m.awayTeamId === teamId);
    const opponentId = !pair ? null : pair.homeTeamId === teamId ? pair.awayTeamId : pair.homeTeamId;
    const opponent = opponentId === null ? null : (week.teams.find((t) => t.team.teamId === opponentId) ?? null);
    return { team, opponent };
  });

  readonly status = computed<StartSitStatus>(() => {
    if (!this.weekRequest()) return 'idle';
    if (this.error()) return 'error';
    if (this.outlook.error()) return 'unavailable';
    const league = this.outlook.league();
    if (league && !league.lineupSlots.length) return 'unavailable';
    if (!this.side() || !league || this.projections.status() === 'loading') return 'loading';
    return 'ready';
  });

  readonly advice = computed<StartSitAdvice | null>(() => {
    const side = this.side();
    const slots = this.outlook.league()?.lineupSlots;
    if (this.status() !== 'ready' || !side || !slots) return null;
    return startSitAdvice({
      players: side.team.team.players,
      slots,
      projectionOf: this.projections.projectionOf(),
      residualsOf: this.projections.residualsOf(),
      now: this.clock(),
    });
  });

  // The number of suggested changes and the points they gain, for the roster hint. Null when there
  // are none, or while anything is loading.
  readonly summary = computed(() => {
    const advice = this.advice();
    return advice?.changes.length ? { changes: advice.changes.length, gain: advice.gain } : null;
  });

  readonly winChange = computed<WinChange | null>(() => {
    const side = this.side();
    const advice = this.advice();
    const week = this.week();
    if (!side?.opponent || !advice || !week || week.scoringPeriodsInMatchup > 1) return null;

    const projectionOf = this.projections.projectionOf();
    const residualsOf = this.projections.residualsOf();
    const now = this.clock();
    // The suggested lineup: the optimizer's starters, plus starters it leaves alone (IDP slots).
    const bestStarters = new Set(advice.best.starters.flatMap((s) => (s.player ? [s.player.playerId] : [])));
    const optimized = new Set([...bestStarters, ...advice.best.bench.map((p) => p.playerId)]);
    const suggested: MatchupTeam = {
      ...side.team,
      team: {
        ...side.team.team,
        players: side.team.team.players.map((p) => ({
          ...p,
          starter: bestStarters.has(p.playerId) || (p.starter && !optimized.has(p.playerId)),
        })),
      },
    };
    return {
      before: winProbability(side.team, side.opponent, projectionOf, residualsOf, now).team,
      after: winProbability(suggested, side.opponent, projectionOf, residualsOf, now).team,
    };
  });

  // Each player's position rank on this week's projections ("WR14"), or undefined while the
  // rankings load, if they failed, or for a player outside the pool.
  private readonly weekRanks = computed(
    () =>
      new Map(
        (this.rankingsService.rankingsFor('week')?.players ?? []).map((p) => [p.playerId, `${p.position}${p.positionRank}`] as const),
      ),
  );

  weekRankOf(playerId: number): string | undefined {
    return this.weekRanks().get(playerId);
  }

  readonly ranksShown = computed(() => this.weekRanks().size > 0);
}
