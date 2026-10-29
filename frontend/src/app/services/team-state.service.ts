import { Injectable, computed, signal } from '@angular/core';
import { DemoScenario } from '../models/demo.model';
import { ImportTeamRequest, Team } from '../models/team.model';
import { DEMO_LEAGUE_ID } from '../utils/demo';

const LAST_IMPORT_KEY = 'fantasyx.lastImport';
const LAST_DEMO_KEY = 'fantasyx.lastDemo';

// Enough to re-import the last team after a page refresh. Deliberately excludes the ESPN cookies:
// a private league is restored with the cookies saved server-side for this device, if any.
export interface LastImport {
  leagueId: number;
  season: number;
  teamId: number;
  isPrivate: boolean;
}

// Enough to pick the demo up where it was after a page refresh: the scenario, the team, and when
// it was started (real time), so the game-day replay carries on rather than restarts.
// Kept apart from the last import, so the user's own team is still there after leaving the demo.
export interface LastDemo {
  scenario: DemoScenario;
  teamId: number;
  startedAt: number;
}

@Injectable({ providedIn: 'root' })
export class TeamStateService {
  // The user's own imported team. Other teams in the league are fetched on demand, not kept here.
  readonly team = signal<Team | null>(null);

  // The league context (including any private-league cookies) the team was imported with, kept
  // in memory only so follow-up calls like player detail can reuse it. Rebuilt on a refresh by
  // ImportRestoreService from the last import below.
  readonly importRequest = signal<ImportTeamRequest | null>(null);

  readonly myTeamId = computed(() => this.team()?.teamId ?? null);

  // True while the last import is being re-imported after a page load.
  readonly restoring = signal(false);
  // Why that re-import failed, if it did; shown on the Import page.
  readonly restoreError = signal<string | null>(null);

  setTeam(team: Team, request: ImportTeamRequest): void {
    this.team.set(team);
    this.importRequest.set(request);
    this.restoreError.set(null);
    // The demo league is remembered on its own (DemoModeService), so the user's own team still
    // comes back once they leave it. Importing their own team leaves the demo for good.
    if (request.leagueId === DEMO_LEAGUE_ID) return;
    this.forgetLastDemo();
    this.writeLastImport({
      leagueId: request.leagueId,
      season: request.season,
      teamId: request.teamId,
      isPrivate: !!request.espnS2 && !!request.swid,
    });
  }

  // Back to no team, as before the first import (leaving the demo). The last import is kept.
  clear(): void {
    this.team.set(null);
    this.importRequest.set(null);
  }

  lastImport(): LastImport | null {
    return this.read<LastImport>(LAST_IMPORT_KEY);
  }

  forgetLastImport(): void {
    this.remove(LAST_IMPORT_KEY);
  }

  lastDemo(): LastDemo | null {
    return this.read<LastDemo>(LAST_DEMO_KEY);
  }

  rememberDemo(lastDemo: LastDemo): void {
    this.write(LAST_DEMO_KEY, lastDemo);
  }

  forgetLastDemo(): void {
    this.remove(LAST_DEMO_KEY);
  }

  private writeLastImport(lastImport: LastImport): void {
    this.write(LAST_IMPORT_KEY, lastImport);
  }

  private read<T>(key: string): T | null {
    try {
      const stored = localStorage.getItem(key);
      return stored ? (JSON.parse(stored) as T) : null;
    } catch {
      // localStorage unavailable or the entry is unreadable - nothing to restore.
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // localStorage unavailable - it just won't survive a refresh.
    }
  }

  private remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // localStorage unavailable - nothing to forget.
    }
  }
}
