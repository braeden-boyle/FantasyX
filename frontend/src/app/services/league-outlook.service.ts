import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, map, of, shareReplay, startWith, switchMap } from 'rxjs';
import { EspnApiService } from './espn-api.service';
import { ProjectionsService } from './projections.service';
import { TeamStateService } from './team-state.service';
import { WeekMatchupsService } from './week-matchups.service';
import { Draft, ImportTeamRequest, League, MatchupTeam, WeekMatchups } from '../models/team.model';
import {
  PowerRank,
  RESULTS_WEIGHT_GAMES,
  bestLineupTotal,
  completedScores,
  powerRankings,
  rankByStrength,
  rosterStrength,
  teamStrength,
} from '../utils/power-rankings';
import { OddsInput, PlayoffOdds, TeamOdds, playoffOdds, weeklySpread } from '../utils/playoff-odds';

interface LeagueLoad {
  league: League | null;
  error: string | null;
}

type WeekLoad = { status: 'loading' } | { status: 'ready'; week: WeekMatchups } | { status: 'failed' };

// A team's power rank, plus where it ranked on draft day (each team's best lineup from its draft
// picks, on week 1 projections) and the places climbed since. Both null without a draft.
export interface RankedTeam extends PowerRank {
  draftRank: number | null;
  sinceDraft: number | null;
}

// completedWeeks: regular-season weeks the ranking is through (0 before week 1). Movement compares
// with the ranking through the week before that; after week 1, that's the draft-day ranking.
// hasDraft: the draft-day ranking is available.
// resultsWeight: the share of strength that's points per week rather than the roster's projection.
// resultsOnly: rosters failed to load, so strength is points per week alone.
// movementUnavailable: the history behind last week's roster strength failed, so no arrows.
export interface RankingsView {
  status: 'loading' | 'ready' | 'unavailable';
  rankings: RankedTeam[];
  completedWeeks: number;
  hasDraft: boolean;
  resultsWeight: number;
  resultsOnly: boolean;
  movementUnavailable: boolean;
}

// odds is null when there's nothing to estimate (no playoff settings, or the regular season is over).
export type OddsView = { status: 'loading' } | { status: 'ready'; odds: PlayoffOdds | null };

const RANKINGS_LOADING: RankingsView = {
  status: 'loading',
  rankings: [],
  completedWeeks: 0,
  hasDraft: false,
  resultsWeight: 0,
  resultsOnly: false,
  movementUnavailable: false,
};

// Power rankings and playoff odds for the imported league, shared by the league page and every
// roster page's tiles. Both use completed weeks only, so they change once a week, when ESPN moves
// on to the next matchup period; the roster term and projections follow the ESPN / FantasyX setting.
// The league is cached for the session; the league page refetches it on each visit (and Retry) to
// keep standings and live scores fresh. Rosters come from the cached week of matchups.
@Injectable({ providedIn: 'root' })
export class LeagueOutlookService {
  private readonly espnApi = inject(EspnApiService);
  private readonly teamState = inject(TeamStateService);
  private readonly weekMatchups = inject(WeekMatchupsService);
  private readonly projections = inject(ProjectionsService);

  private readonly wanted = signal(false);
  private readonly reloads = signal(0);
  private forceNext = false;
  private cachedFor: ImportTeamRequest | null = null;
  private cached: Observable<League> | null = null;

  private readonly leagueRequest = computed(() => {
    const request = this.teamState.importRequest();
    if (!request || !this.wanted()) return null;
    this.reloads();
    return request;
  });

  private readonly leagueLoad = toSignal(
    toObservable(this.leagueRequest).pipe(
      switchMap((request) =>
        request
          ? this.fetchLeague(request).pipe(
              map((league): LeagueLoad => ({ league, error: null })),
              catchError((err) => of({ league: null, error: err?.error?.title ?? 'Could not load the league.' })),
              startWith(null),
            )
          : of(null),
      ),
    ),
    { initialValue: null },
  );

  readonly loading = computed(() => this.leagueRequest() !== null && this.leagueLoad() === null);
  readonly error = computed(() => this.leagueLoad()?.error ?? null);
  readonly league = computed(() => this.leagueLoad()?.league ?? null);

  private readonly weekLoad = toSignal(
    toObservable(computed(() => (this.wanted() ? this.teamState.importRequest() : null))).pipe(
      switchMap((request) =>
        request
          ? this.weekMatchups.load().pipe(
              map((week): WeekLoad => ({ status: 'ready', week })),
              catchError(() => of<WeekLoad>({ status: 'failed' })),
              startWith<WeekLoad>({ status: 'loading' }),
            )
          : of(null),
      ),
    ),
    { initialValue: null },
  );

  // The draft never changes once it's done, so it's loaded once per import. A failure just leaves
  // the draft-day ranking out.
  private draftFor: ImportTeamRequest | null = null;
  private draftCache: Observable<Draft> | null = null;
  private readonly draft = toSignal(
    toObservable(computed(() => (this.wanted() ? this.teamState.importRequest() : null))).pipe(
      switchMap((request) => (request ? this.fetchDraft(request).pipe(catchError(() => of(null))) : of(null))),
    ),
    { initialValue: null },
  );

  private fetchDraft(request: ImportTeamRequest): Observable<Draft> {
    if (!this.draftCache || this.draftFor !== request) {
      const { leagueId, season, espnS2, swid } = request;
      this.draftFor = request;
      this.draftCache = this.espnApi.getDraft({ leagueId, season, espnS2, swid }).pipe(shareReplay(1));
    }
    return this.draftCache;
  }

  // Each team's draft-day strength: the best lineup its picks could field on week 1 projections.
  // Null before the draft (or if it didn't load).
  private readonly draftStrengths = computed(() => {
    const draft = this.draft();
    if (!draft?.picks.length || !draft.lineupSlots.length) return null;
    const strengths = new Map<number, number>();
    for (const teamId of new Set(draft.picks.map((p) => p.teamId))) {
      const picks = draft.picks
        .filter((p) => p.teamId === teamId)
        .map((p) => ({ playerId: p.playerId, position: p.position, projected: p.week1Projection }));
      strengths.set(teamId, bestLineupTotal(picks, draft.lineupSlots));
    }
    return strengths;
  });

  // Loads the league if it isn't already (a roster page's tiles).
  ensureLoaded(): void {
    this.projections.ensureLoaded();
    this.wanted.set(true);
  }

  // Refetches the league (the league page, on each visit and on Retry).
  refresh(): void {
    this.projections.ensureLoaded();
    this.forceNext = true;
    this.wanted.set(true);
    this.reloads.update((n) => n + 1);
  }

  private fetchLeague(request: ImportTeamRequest): Observable<League> {
    if (this.forceNext || !this.cached || this.cachedFor !== request) {
      const { leagueId, season, espnS2, swid } = request;
      this.forceNext = false;
      this.cachedFor = request;
      // Resets on error (like WeekMatchupsService), so a failed load is retried on the next subscribe.
      this.cached = this.espnApi.getLeague({ leagueId, season, espnS2, swid }).pipe(shareReplay(1));
    }
    return this.cached;
  }

  // Matchup periods before this one are complete regular-season weeks.
  private readonly completedBefore = computed(() => {
    const league = this.league();
    if (!league) return 0;
    const regular = league.regularSeasonMatchupPeriods || Infinity;
    return Math.min(league.currentMatchupPeriod, regular + 1);
  });

  readonly rankings = computed<RankingsView | null>(() => {
    const league = this.league();
    const week = this.weekLoad();
    if (!league) return null;
    if (!week || week.status === 'loading' || this.projections.status() === 'loading') return RANKINGS_LOADING;

    const rosters = week.status === 'ready' ? week.week.teams : null;
    const strengthsAsOf = (beforePeriod: number, rosterOf: ((team: MatchupTeam) => number) | null) => {
      const scores = completedScores(league.schedule, beforePeriod);
      const strengths = new Map<number, number>();
      for (const { teamId } of league.standings) {
        const team = rosters?.find((t) => t.team.teamId === teamId);
        const parts = teamStrength(scores.get(teamId) ?? [], rosterOf && team ? rosterOf(team) : null);
        if (parts) strengths.set(teamId, parts.strength);
      }
      return strengths;
    };

    const completedBefore = this.completedBefore();
    const projectionOf = this.projections.projectionOf();
    const now = strengthsAsOf(completedBefore, rosters ? (t) => rosterStrength(t.team.players, projectionOf) : null);
    if (!now.size) return { ...RANKINGS_LOADING, status: 'unavailable' };

    // Last week's ranking: results through the week before, and the roster term from today's
    // rosters' projections for that week (traded players count for their current team). After
    // week 1 the ranking before it is draft day's, when there is one.
    const lastCompleted = completedBefore - 1;
    const draft = this.draftStrengths();
    let previous: Map<number, number> | null = null;
    if (lastCompleted === 1 && draft) {
      previous = draft;
    } else if (lastCompleted >= 1) {
      const past = this.projections.pastProjectionOf();
      if (week.status !== 'ready') {
        previous = strengthsAsOf(lastCompleted, null);
      } else if (past) {
        const { matchupPeriod, scoringPeriod } = week.week;
        // Regular-season matchup periods are one scoring period each, so the offset carries over.
        const offset = matchupPeriod <= (league.regularSeasonMatchupPeriods || Infinity) ? scoringPeriod - matchupPeriod : 0;
        const pastWeek = lastCompleted + offset;
        previous = strengthsAsOf(lastCompleted, (t) => rosterStrength(t.team.players, (p) => past(p, pastWeek)));
      }
    }

    const draftRanks = draft ? rankByStrength(draft) : null;
    return {
      status: 'ready',
      rankings: powerRankings(now, previous).map((r) => {
        const draftRank = draftRanks?.get(r.teamId) ?? null;
        return { ...r, draftRank, sinceDraft: draftRank === null ? null : draftRank - r.rank };
      }),
      completedWeeks: lastCompleted,
      hasDraft: draftRanks !== null,
      resultsWeight: rosters ? lastCompleted / (lastCompleted + RESULTS_WEIGHT_GAMES) : 1,
      resultsOnly: rosters === null,
      movementUnavailable: this.projections.historyStatus() === 'failed' && rosters !== null,
    };
  });

  private readonly ranksById = computed(
    () => new Map((this.rankings()?.rankings ?? []).map((r) => [r.teamId, r] as const)),
  );

  rankOf(teamId: number): RankedTeam | undefined {
    return this.ranksById().get(teamId);
  }

  private readonly oddsInput = computed<OddsInput | null>(() => {
    const league = this.league();
    const rankings = this.rankings();
    if (!league || rankings?.status !== 'ready') return null;
    const strengths = new Map(rankings.rankings.map((r) => [r.teamId, r.strength] as const));
    const average = [...strengths.values()].reduce((sum, s) => sum + s, 0) / strengths.size;
    return {
      teams: league.standings.map((s) => ({
        teamId: s.teamId,
        divisionId: s.divisionId,
        strength: strengths.get(s.teamId) ?? average,
      })),
      schedule: league.schedule,
      currentPeriod: league.currentMatchupPeriod,
      regularSeasonPeriods: league.regularSeasonMatchupPeriods,
      playoffTeamCount: league.playoffTeamCount,
      seedingRule: league.playoffSeedingRule,
      spread: weeklySpread(league.schedule, this.completedBefore()),
    };
  }, { equal: sameOddsInput });

  private readonly oddsLoad = toSignal(
    toObservable(this.oddsInput).pipe(
      switchMap((input) =>
        input
          ? runPlayoffOdds(input).pipe(
              map((odds): OddsView => ({ status: 'ready', odds })),
              startWith<OddsView>({ status: 'loading' }),
            )
          : of(null),
      ),
    ),
    { initialValue: null },
  );

  readonly odds = computed<OddsView | null>(() => {
    const rankings = this.rankings();
    if (rankings?.status === 'loading') return { status: 'loading' };
    return rankings?.status === 'ready' ? (this.oddsLoad() ?? { status: 'loading' }) : null;
  });

  private readonly oddsById = computed(() => {
    const odds = this.odds();
    return new Map(odds?.status === 'ready' ? (odds.odds?.teams ?? []).map((t) => [t.teamId, t] as const) : []);
  });

  oddsOf(teamId: number): TeamOdds | undefined {
    return this.oddsById().get(teamId);
  }
}

// Rankings recompute when movement arrives, with the same strengths; only rerun the odds when
// something they depend on has changed.
function sameOddsInput(a: OddsInput | null, b: OddsInput | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.schedule !== b.schedule || a.spread !== b.spread || a.teams.length !== b.teams.length) return false;
  return a.teams.every((t, i) => t.teamId === b.teams[i].teamId && t.strength === b.teams[i].strength);
}

// The simulation and exact clinch check run in a web worker so they never block the page, or
// inline where workers aren't available.
function runPlayoffOdds(input: OddsInput): Observable<PlayoffOdds | null> {
  if (typeof Worker === 'undefined') return of(playoffOdds(input));
  return new Observable<PlayoffOdds | null>((subscriber) => {
    const worker = new Worker(new URL('../workers/playoff-odds.worker', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<PlayoffOdds | null>) => {
      subscriber.next(data);
      subscriber.complete();
    };
    worker.onerror = () => {
      subscriber.next(playoffOdds(input));
      subscriber.complete();
    };
    worker.postMessage(input);
    return () => worker.terminate();
  });
}
