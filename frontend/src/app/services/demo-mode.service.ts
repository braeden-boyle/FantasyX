import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, forkJoin, map, of, shareReplay, switchMap, tap } from 'rxjs';
import { EspnApiService } from './espn-api.service';
import { TeamStateService } from './team-state.service';
import { DemoFrame, DemoManifest, DemoScenario } from '../models/demo.model';
import { ImportTeamRequest } from '../models/team.model';
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

  readonly active = computed(() => !!this.state() && this.teamState.importRequest()?.leagueId === DEMO_LEAGUE_ID);
  readonly scenario = computed(() => (this.active() ? this.state()!.scenario : null));

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

  // Imports a demo team (the scenario's default when none is given), starting the scenario afresh.
  start(scenario: DemoScenario, teamId?: number): Observable<void> {
    return this.load(scenario).pipe(
      switchMap((fixtures) => {
        this.state.set({ scenario, ...fixtures, startedAt: Date.now() });
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

  // Leaves the demo for the import page, with no team imported.
  exit(): void {
    this.state.set(null);
    if (this.teamState.importRequest()?.leagueId === DEMO_LEAGUE_ID) this.teamState.clear();
    this.router.navigateByUrl('/import');
  }

  // Starts the demo from a shared link: ?demo=gameday (or anything else for mid-week) and an
  // optional &team=, on any route. Both are taken off the address before the router reads it, and
  // a link to the bare site opens the demo on My Team. Returns whether there was a link to follow;
  // the app holds back its pages until the team is in, as when restoring the last import.
  startFromLink(): boolean {
    const url = new URL(window.location.href);
    const demo = url.searchParams.get('demo');
    if (demo === null) return false;
    const team = Number(url.searchParams.get('team'));
    url.searchParams.delete('demo');
    url.searchParams.delete('team');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);

    const toTeamPage = url.pathname === '/' || url.pathname === '/import';
    this.teamState.restoring.set(true);
    this.start(demo === 'gameday' ? 'gameday' : 'midweek', Number.isInteger(team) && team > 0 ? team : undefined).subscribe({
      next: () => {
        this.teamState.restoring.set(false);
        if (toTeamPage) this.router.navigateByUrl('/team');
      },
      error: () => {
        this.teamState.restoreError.set('Could not load the demo league.');
        this.teamState.restoring.set(false);
      },
    });
    return true;
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
      tap((team) => this.teamState.setTeam(team, request)),
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
