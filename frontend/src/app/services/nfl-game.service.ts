import { Injectable, inject } from '@angular/core';
import { Observable, map, of, tap, throwError } from 'rxjs';
import { EspnApiService } from './espn-api.service';
import { TeamStateService } from './team-state.service';
import { ImportTeamRequest, NflGameDetail } from '../models/team.model';

// A game's summary and when it was fetched, so live refreshes are timed from the fetch rather than
// from when a cached game was reopened.
export interface LoadedNflGame {
  detail: NflGameDetail;
  fetchedAt: Date;
}

// Session cache of NFL game summaries, keyed by league + season + week + game, so stepping back to a
// game already opened is instant. `force` refetches one game (Refresh, or live updates). The whole
// cache is dropped when a different team import is in effect, since the fantasy points follow the
// league's scoring.
@Injectable({ providedIn: 'root' })
export class NflGameService {
  private readonly espnApi = inject(EspnApiService);
  private readonly teamState = inject(TeamStateService);

  private readonly cache = new Map<string, LoadedNflGame>();
  private cachedFor: ImportTeamRequest | null = null;

  load(eventId: string, scoringPeriod: number, force = false): Observable<LoadedNflGame> {
    const request = this.teamState.importRequest();
    if (!request) {
      return throwError(() => new Error('No team has been imported.'));
    }

    if (request !== this.cachedFor) {
      this.cache.clear();
      this.cachedFor = request;
    }

    const key = `${request.leagueId}:${request.season}:${scoringPeriod}:${eventId}`;
    const cached = this.cache.get(key);
    if (cached && !force) {
      return of(cached);
    }

    const { leagueId, season, espnS2, swid } = request;
    return this.espnApi
      .getNflGame({ leagueId, season, espnS2, swid, scoringPeriod, eventId })
      .pipe(
        map((detail) => ({ detail, fetchedAt: new Date() })),
        tap((loaded) => this.cache.set(key, loaded)),
      );
  }
}
