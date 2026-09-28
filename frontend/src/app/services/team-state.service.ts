import { Injectable, computed, signal } from '@angular/core';
import { ImportTeamRequest, Team } from '../models/team.model';

const LAST_IMPORT_KEY = 'fantasyx.lastImport';

// Enough to re-import the last team after a page refresh. Deliberately excludes the ESPN cookies:
// a private league is restored with the cookies saved server-side for this device, if any.
export interface LastImport {
  leagueId: number;
  season: number;
  teamId: number;
  isPrivate: boolean;
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
    this.writeLastImport({
      leagueId: request.leagueId,
      season: request.season,
      teamId: request.teamId,
      isPrivate: !!request.espnS2 && !!request.swid,
    });
  }

  lastImport(): LastImport | null {
    try {
      const stored = localStorage.getItem(LAST_IMPORT_KEY);
      return stored ? (JSON.parse(stored) as LastImport) : null;
    } catch {
      // localStorage unavailable or the entry is unreadable - nothing to restore.
      return null;
    }
  }

  forgetLastImport(): void {
    try {
      localStorage.removeItem(LAST_IMPORT_KEY);
    } catch {
      // localStorage unavailable - nothing to forget.
    }
  }

  private writeLastImport(lastImport: LastImport): void {
    try {
      localStorage.setItem(LAST_IMPORT_KEY, JSON.stringify(lastImport));
    } catch {
      // localStorage unavailable - the team just won't survive a refresh.
    }
  }
}
