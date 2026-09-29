import { Injectable, inject } from '@angular/core';
import { Observable, map, shareReplay, throwError } from 'rxjs';
import { EspnApiService } from './espn-api.service';
import { TeamStateService } from './team-state.service';
import { ImportTeamRequest, PlayerSpread, WeekMatchups } from '../models/team.model';

// Session cache of every rostered player's week-to-week swing, for the matchup view's win
// probability. Swings only change between weeks, so the matchup view's Refresh doesn't refetch
// them; a new scoring period or a different import does.
@Injectable({ providedIn: 'root' })
export class PlayerSpreadsService {
  private readonly espnApi = inject(EspnApiService);
  private readonly teamState = inject(TeamStateService);

  private cachedFor: { request: ImportTeamRequest; scoringPeriod: number } | null = null;
  private cached: Observable<Map<number, PlayerSpread>> | null = null;

  load(week: WeekMatchups): Observable<Map<number, PlayerSpread>> {
    const request = this.teamState.importRequest();
    if (!request) {
      return throwError(() => new Error('No team has been imported.'));
    }

    const { scoringPeriod } = week;
    if (!this.cached || this.cachedFor?.request !== request || this.cachedFor.scoringPeriod !== scoringPeriod) {
      const { leagueId, season, espnS2, swid } = request;
      // Benches are included so a lineup change picked up by Refresh already has a swing.
      const playerIds = [...new Set(week.teams.flatMap((t) => t.team.players.map((p) => p.playerId)))];
      this.cachedFor = { request, scoringPeriod };
      // Resets on error (like WeekMatchupsService), so a failed load is retried on the next subscribe.
      this.cached = this.espnApi
        .getPlayerSpreads({ leagueId, season, espnS2, swid, scoringPeriod, playerIds })
        .pipe(
          map((spreads) => new Map(spreads.map((s) => [s.playerId, s] as const))),
          shareReplay(1),
        );
    }
    return this.cached;
  }
}
