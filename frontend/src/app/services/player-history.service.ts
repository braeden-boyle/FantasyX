import { Injectable, inject } from '@angular/core';
import { Observable, map, shareReplay, throwError } from 'rxjs';
import { EspnApiService } from './espn-api.service';
import { TeamStateService } from './team-state.service';
import { HistoryWeek, ImportTeamRequest, WeekMatchups } from '../models/team.model';

// Each player's played weeks, and their projection by upcoming week (missing for a week they're
// not projected).
export interface HistoryAndUpcoming {
  histories: Map<number, HistoryWeek[]>;
  upcoming: Map<number, ReadonlyMap<number, number>>;
}

// Session cache of every rostered player's weekly points against ESPN's projection this season,
// behind FantasyX projections, the backtest and win probability's spreads, plus their projections
// for the weeks still to come, behind power rankings and playoff odds. History only changes
// between weeks, so the matchup view's Refresh doesn't refetch it; a new scoring period or a
// different import does.
@Injectable({ providedIn: 'root' })
export class PlayerHistoryService {
  private readonly espnApi = inject(EspnApiService);
  private readonly teamState = inject(TeamStateService);

  private cachedFor: { request: ImportTeamRequest; scoringPeriod: number } | null = null;
  private cached: Observable<HistoryAndUpcoming> | null = null;

  load(week: WeekMatchups): Observable<HistoryAndUpcoming> {
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
          map((histories) => ({
            histories: new Map(histories.map((h) => [h.playerId, h.weeks] as const)),
            upcoming: new Map(
              histories.map((h) => [h.playerId, new Map(h.upcoming.map((u) => [u.week, u.projected] as const))] as const),
            ),
          })),
          shareReplay(1),
        );
    }
    return this.cached;
  }
}
