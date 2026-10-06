import { Injectable, inject } from '@angular/core';
import { Observable, shareReplay, throwError } from 'rxjs';
import { EspnApiService } from './espn-api.service';
import { TeamStateService } from './team-state.service';
import { AvailablePlayer, ImportTeamRequest } from '../models/team.model';
import { AVAILABLE_PER_POSITION } from '../utils/player-rankings';

// Session cache of the league's most-owned free agents and waiver players at each starting
// position, with their history and upcoming projections, for player rankings. Only loaded when the
// rankings are wanted. Like PlayerHistoryService, a new scoring period or a different import
// refetches it.
@Injectable({ providedIn: 'root' })
export class AvailablePlayersService {
  private readonly espnApi = inject(EspnApiService);
  private readonly teamState = inject(TeamStateService);

  private cachedFor: { request: ImportTeamRequest; scoringPeriod: number; positions: string } | null = null;
  private cached: Observable<AvailablePlayer[]> | null = null;

  load(scoringPeriod: number, positions: readonly string[]): Observable<AvailablePlayer[]> {
    const request = this.teamState.importRequest();
    if (!request) {
      return throwError(() => new Error('No team has been imported.'));
    }

    const key = positions.join(',');
    const cachedFor = this.cachedFor;
    if (
      !this.cached ||
      cachedFor?.request !== request ||
      cachedFor.scoringPeriod !== scoringPeriod ||
      cachedFor.positions !== key
    ) {
      const { leagueId, season, espnS2, swid } = request;
      this.cachedFor = { request, scoringPeriod, positions: key };
      // Resets on error (like WeekMatchupsService), so a failed load is retried on the next subscribe.
      this.cached = this.espnApi
        .getAvailablePlayers({
          leagueId,
          season,
          espnS2,
          swid,
          scoringPeriod,
          positions: [...positions],
          perPosition: AVAILABLE_PER_POSITION,
        })
        .pipe(shareReplay(1));
    }
    return this.cached;
  }
}
