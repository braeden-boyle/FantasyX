import { Injectable, inject } from '@angular/core';
import { Observable, map, shareReplay, throwError } from 'rxjs';
import { EspnApiService } from './espn-api.service';
import { TeamStateService } from './team-state.service';
import { HistoryWeek, ImportTeamRequest, WeekMatchups } from '../models/team.model';

// Session cache of every rostered player's weekly points against ESPN's projection this season,
// behind FantasyX projections, the backtest and win probability's spreads. History only changes
// between weeks, so the matchup view's Refresh doesn't refetch it; a new scoring period or a
// different import does.
@Injectable({ providedIn: 'root' })
export class PlayerHistoryService {
  private readonly espnApi = inject(EspnApiService);
  private readonly teamState = inject(TeamStateService);

  private cachedFor: { request: ImportTeamRequest; scoringPeriod: number } | null = null;
  private cached: Observable<Map<number, HistoryWeek[]>> | null = null;

  load(week: WeekMatchups): Observable<Map<number, HistoryWeek[]>> {
    const request = this.teamState.importRequest();
    if (!request) {
      return throwError(() => new Error('No team has been imported.'));
    }

    const { scoringPeriod } = week;
    if (!this.cached || this.cachedFor?.request !== request || this.cachedFor.scoringPeriod !== scoringPeriod) {
      const { leagueId, season, espnS2, swid } = request;
      // Benches are included so a lineup change picked up by Refresh already has a history.
      const playerIds = [...new Set(week.teams.flatMap((t) => t.team.players.map((p) => p.playerId)))];
      this.cachedFor = { request, scoringPeriod };
      // Resets on error (like WeekMatchupsService), so a failed load is retried on the next subscribe.
      this.cached = this.espnApi
        .getPlayerHistory({ leagueId, season, espnS2, swid, scoringPeriod, playerIds })
        .pipe(
          map((histories) => new Map(histories.map((h) => [h.playerId, h.weeks] as const))),
          shareReplay(1),
        );
    }
    return this.cached;
  }
}
