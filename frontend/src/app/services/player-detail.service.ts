import { Injectable, inject } from '@angular/core';
import { Observable, of, tap, throwError } from 'rxjs';
import { EspnApiService } from './espn-api.service';
import { TeamStateService } from './team-state.service';
import { ImportTeamRequest, PlayerDetail } from '../models/team.model';

// Session cache of player detail, keyed by league + season + player. Fetched on demand the first
// time a player is opened; `force` refetches one player (e.g. for live scores). The whole cache is
// dropped when a different team import is in effect.
@Injectable({ providedIn: 'root' })
export class PlayerDetailService {
  private readonly espnApi = inject(EspnApiService);
  private readonly teamState = inject(TeamStateService);

  private readonly cache = new Map<string, PlayerDetail>();
  private cachedFor: ImportTeamRequest | null = null;

  load(playerId: number, force = false): Observable<PlayerDetail> {
    const request = this.teamState.importRequest();
    if (!request) {
      return throwError(() => new Error('No team has been imported.'));
    }

    if (request !== this.cachedFor) {
      this.cache.clear();
      this.cachedFor = request;
    }

    const key = `${request.leagueId}:${request.season}:${playerId}`;
    const cached = this.cache.get(key);
    if (cached && !force) {
      return of(cached);
    }

    return this.espnApi
      .getPlayer({
        leagueId: request.leagueId,
        season: request.season,
        espnS2: request.espnS2,
        swid: request.swid,
        playerId,
      })
      .pipe(tap((detail) => this.cache.set(key, detail)));
  }
}
