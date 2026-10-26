import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, catchError, forkJoin, map, of, shareReplay, switchMap, tap } from 'rxjs';
import { EspnApiService } from './espn-api.service';
import { TeamStateService } from './team-state.service';
import { DEMO_SCENARIOS, DemoFrame, DemoManifest, DemoScenario } from '../models/demo.model';
import { ImportTeamRequest, TeamSummary } from '../models/team.model';
import {
  DEMO_LEAGUE_ID,
  DemoRoute,
  demoRoute,
  msUntilNextStep,
  replayStep,
  skipAheadStart,
  stepFrame,
  stepTimes,
} from '../utils/demo';

// One scenario's fixtures index: its manifest, and on game day the replay's frames.
interface ScenarioFixtures {
  manifest: DemoManifest;
  frames: DemoFrame[];
}

interface DemoState extends ScenarioFixtures {
  scenario: DemoScenario;
  // When the scenario was started, in real time: mid-week's clock runs on from its capture time by
  // the time since, and game day's replay steps on from it.
  startedAt: number;
}

// The demo league: a real league's week, scrubbed and bundled under public/demo/, for visitors to
// try the app without a league of their own. It's imported like any team, as league DEMO_LEAGUE_ID,
// and the demo interceptor answers its requests from the fixtures. The demo is on while that's the
// imported league. See docs/PLAN.md, "Demo mode".
@Injectable({ providedIn: 'root' })
export class DemoModeService {
  private readonly http = inject(HttpClient);
  private readonly espnApi = inject(EspnApiService);
  private readonly teamState = inject(TeamStateService);
  private readonly router = inject(Router);

  private readonly state = signal<DemoState | null>(null);
  private readonly fixtures = new Map<DemoScenario, Observable<ScenarioFixtures>>();
  private readonly teamLists = new Map<DemoScenario, Observable<TeamSummary[]>>();

  readonly active = computed(() => !!this.state() && this.teamState.importRequest()?.leagueId === DEMO_LEAGUE_ID);
  readonly scenario = computed(() => (this.active() ? this.state()!.scenario : null));
  // The demo team the visitor is, while the demo is on.
  readonly teamId = computed(() => (this.active() ? this.teamState.importRequest()!.teamId : null));

  // The demo clock: mid-week runs on from the capture at real speed, and game day shows the current
  // step's time. Null outside the demo.
  now(): Date | null {
    const state = this.activeState();
    if (!state) return null;
    if (state.scenario === 'midweek') {
      return new Date(Date.parse(state.manifest.capturedAt) + Date.now() - state.startedAt);
    }
    const times = stepTimes(state.manifest, state.frames);
    return new Date(times[replayStep(times.length, state.startedAt, Date.now())]);
  }

  // How long to wait, in real time, for a refresh due `delay` from the demo clock's now. Game day
  // refreshes at each step of the replay instead, since its clock only moves between steps. Null
  // outside the demo.
  refreshDelay(delay: number): number | null {
    const state = this.activeState();
    if (!state) return null;
    if (state.scenario === 'midweek') return delay;
    return msUntilNextStep(state.frames.length + 1, state.startedAt, Date.now()) ?? delay;
  }

  // The fixture answering a demo request to /api/espn/<endpoint>, as the replay stands now. Null
  // when the demo has no answer for it, including before a scenario has loaded.
  route(endpoint: string, body: Record<string, unknown>): DemoRoute | null {
    const state = this.state();
    if (!state) return null;
    const frame =
      state.scenario === 'gameday' ? stepFrame(replayStep(state.frames.length + 1, state.startedAt, Date.now())) : null;
    return demoRoute(endpoint, body, state.scenario, frame, state.frames);
  }

  // Imports a demo team (the scenario's default when none is given), starting the scenario afresh,
  // or from startedAt when picking up a saved demo.
  start(scenario: DemoScenario, teamId?: number, startedAt = Date.now()): Observable<void> {
    return this.load(scenario).pipe(
      switchMap((fixtures) => {
        this.state.set({ scenario, ...fixtures, startedAt });
        const id = teamId !== undefined && fixtures.manifest.teamIds.includes(teamId) ? teamId : fixtures.manifest.defaultTeamId;
        return this.importTeam(id);
      }),
    );
  }

  // Becomes another team in the same scenario, keeping the clock where it is.
  switchTeam(teamId: number): Observable<void> {
    return this.importTeam(teamId);
  }

  // Moves the game-day replay on by `minutes` of game time.
  skipAhead(minutes = 30): Observable<void> {
    const state = this.activeState();
    if (state?.scenario !== 'gameday') return of(undefined);
    const startedAt = skipAheadStart(stepTimes(state.manifest, state.frames), state.startedAt, Date.now(), minutes);
    this.state.set({ ...state, startedAt });
    return this.reimport();
  }

  // Back to the start of the scenario: the Sunday-morning capture on game day.
  restart(): Observable<void> {
    const state = this.activeState();
    if (!state) return of(undefined);
    this.state.set({ ...state, startedAt: Date.now() });
    return this.reimport();
  }

  // Leaves the demo for the import page, with no team imported. It's forgotten, so the next load
  // brings back the user's own last team, if any.
  exit(): void {
    this.state.set(null);
    this.teamState.forgetLastDemo();
    if (this.teamState.importRequest()?.leagueId === DEMO_LEAGUE_ID) this.teamState.clear();
    this.router.navigateByUrl('/import');
  }

  // Starts the demo from a shared link: ?demo=gameday (or anything else for mid-week) and an
  // optional &team=, on any route. Both are taken off the address before the router reads it, and
  // a link to the bare site opens the demo on My Team. Returns whether there was a link to follow.
  startFromLink(): boolean {
    const url = new URL(window.location.href);
    const demo = url.searchParams.get('demo');
    if (demo === null) return false;
    const team = Number(url.searchParams.get('team'));
    url.searchParams.delete('demo');
    url.searchParams.delete('team');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);

    const scenario = demo === 'gameday' ? 'gameday' : 'midweek';
    this.follow(this.start(scenario, Number.isInteger(team) && team > 0 ? team : undefined), {
      toTeamPage: url.pathname === '/' || url.pathname === '/import',
      error: 'Could not load the demo league.',
    });
    return true;
  }

  // Picks the demo up where it was before a page load, if it was on: the same scenario and team,
  // with the clock and the game-day replay carried on. Returns whether there was a demo to resume.
  resumeLast(): boolean {
    const last = this.teamState.lastDemo();
    if (!last) return false;
    this.follow(this.start(last.scenario, last.teamId, last.startedAt), {
      toTeamPage: false,
      // Its fixtures may have changed or gone; the user's own team comes back on the next load.
      error: 'Could not reload the demo league.',
      onError: () => this.teamState.forgetLastDemo(),
    });
    return true;
  }

  // The scenarios with fixtures to show. Game day is only there once a Sunday has been recorded.
  available(): Observable<DemoScenario[]> {
    return forkJoin(
      DEMO_SCENARIOS.map((scenario) =>
        this.load(scenario).pipe(
          map(() => [scenario]),
          catchError(() => of([])),
        ),
      ),
    ).pipe(map((found) => found.flat()));
  }

  // A scenario's manifest, for the team a visitor starts as.
  manifest(scenario: DemoScenario): Observable<DemoManifest> {
    return this.load(scenario).pipe(map((fixtures) => fixtures.manifest));
  }

  // The demo league's teams, for the team pickers. Both scenarios are the same league.
  teams(scenario: DemoScenario): Observable<TeamSummary[]> {
    let teams = this.teamLists.get(scenario);
    if (!teams) {
      teams = this.http.get<TeamSummary[]>(`demo/${scenario}/teams.json`).pipe(shareReplay(1));
      this.teamLists.set(scenario, teams);
    }
    return teams;
  }

  // Real milliseconds until the game-day replay's next step: null on its last step, and outside
  // game day.
  nextStepIn(): number | null {
    const state = this.activeState();
    if (state?.scenario !== 'gameday') return null;
    return msUntilNextStep(state.frames.length + 1, state.startedAt, Date.now());
  }

  // Runs a demo start on page load, holding the app's pages back until the team is in, as when
  // restoring the last import.
  private follow(start: Observable<void>, options: { toTeamPage: boolean; error: string; onError?: () => void }): void {
    this.teamState.restoring.set(true);
    start.subscribe({
      next: () => {
        this.teamState.restoring.set(false);
        if (options.toTeamPage) this.router.navigateByUrl('/team');
      },
      error: () => {
        this.state.set(null);
        options.onError?.();
        this.teamState.restoreError.set(options.error);
        this.teamState.restoring.set(false);
      },
    });
  }

  private activeState(): DemoState | null {
    return this.active() ? this.state() : null;
  }

  // A fresh import of the current team, so every cached week, league and game is fetched again as
  // the replay now stands.
  private reimport(): Observable<void> {
    const teamId = this.teamState.importRequest()?.teamId;
    return teamId === undefined ? of(undefined) : this.importTeam(teamId);
  }

  private importTeam(teamId: number): Observable<void> {
    const state = this.state();
    if (!state) throw new Error('No demo scenario has been started.');
    const request: ImportTeamRequest = { leagueId: DEMO_LEAGUE_ID, season: state.manifest.season, teamId };
    return this.espnApi.getTeam(request).pipe(
      tap((team) => {
        this.teamState.setTeam(team, request);
        this.teamState.rememberDemo({ scenario: state.scenario, teamId, startedAt: state.startedAt });
      }),
      map(() => undefined),
    );
  }

  private load(scenario: DemoScenario): Observable<ScenarioFixtures> {
    let fixtures = this.fixtures.get(scenario);
    if (!fixtures) {
      const base = `demo/${scenario}`;
      fixtures = forkJoin({
        manifest: this.http.get<DemoManifest>(`${base}/manifest.json`),
        frames: scenario === 'gameday' ? this.http.get<DemoFrame[]>(`${base}/frames/index.json`) : of([]),
      }).pipe(shareReplay(1));
      this.fixtures.set(scenario, fixtures);
    }
    return fixtures;
  }
}
