import { Injectable, inject, signal } from '@angular/core';
import { Observable, shareReplay, tap, throwError } from 'rxjs';
import { EspnApiService } from './espn-api.service';
import { TeamStateService } from './team-state.service';
import { ImportTeamRequest, WeekMatchups } from '../models/team.model';

// Session cache of the current week's matchups (every team's roster and score). The matchup view
// loads it once, then switches matchups and survives being left and revisited without another
// request. Only a forced load (the view's Refresh button) refetches, and a different import drops it.
@Injectable({ providedIn: 'root' })
export class WeekMatchupsService {
  private readonly espnApi = inject(EspnApiService);
  private readonly teamState = inject(TeamStateService);

  private cachedFor: ImportTeamRequest | null = null;
  private cached: Observable<WeekMatchups> | null = null;

  // When the cached week was fetched, so live games are judged against that moment rather than when
  // the view happened to open. Null before the first load.
  private readonly fetchedAtSignal = signal<Date | null>(null);
  readonly fetchedAt = this.fetchedAtSignal.asReadonly();

  load(force = false): Observable<WeekMatchups> {
    const request = this.teamState.importRequest();
    if (!request) {
      return throwError(() => new Error('No team has been imported.'));
    }

    if (force || !this.cached || request !== this.cachedFor) {
      const { leagueId, season, espnS2, swid } = request;
      this.cachedFor = request;
      // shareReplay replays the loaded week to later subscribers (and shares one in-flight
      // request), but resets on error, so a failed load is retried on the next subscribe.
      this.cached = this.espnApi.getWeekMatchups({ leagueId, season, espnS2, swid }).pipe(
        tap(() => this.fetchedAtSignal.set(new Date())),
        shareReplay(1),
      );
    }
    return this.cached;
  }
}
