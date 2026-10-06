import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AvailablePlayer,
  AvailablePlayersRequest,
  Draft,
  ImportTeamRequest,
  League,
  LeagueTeamsRequest,
  PlayerDetail,
  PlayerDetailRequest,
  PlayerHistory,
  PlayerHistoryRequest,
  Team,
  TeamSummary,
  WeekMatchups,
} from '../models/team.model';

@Injectable({ providedIn: 'root' })
export class EspnApiService {
  private readonly baseUrl = `${environment.apiBaseUrl}/api/espn`;

  constructor(private readonly http: HttpClient) {}

  listTeams(request: LeagueTeamsRequest): Observable<TeamSummary[]> {
    return this.http.post<TeamSummary[]>(`${this.baseUrl}/leagues/teams`, request);
  }

  getLeague(request: LeagueTeamsRequest): Observable<League> {
    return this.http.post<League>(`${this.baseUrl}/league`, request);
  }

  getTeam(request: ImportTeamRequest): Observable<Team> {
    return this.http.post<Team>(`${this.baseUrl}/team`, request);
  }

  getWeekMatchups(request: LeagueTeamsRequest): Observable<WeekMatchups> {
    return this.http.post<WeekMatchups>(`${this.baseUrl}/matchups`, request);
  }

  getPlayer(request: PlayerDetailRequest): Observable<PlayerDetail> {
    return this.http.post<PlayerDetail>(`${this.baseUrl}/player`, request);
  }

  getPlayerHistory(request: PlayerHistoryRequest): Observable<PlayerHistory[]> {
    return this.http.post<PlayerHistory[]>(`${this.baseUrl}/player-history`, request);
  }

  getAvailablePlayers(request: AvailablePlayersRequest): Observable<AvailablePlayer[]> {
    return this.http.post<AvailablePlayer[]>(`${this.baseUrl}/available-players`, request);
  }

  getDraft(request: LeagueTeamsRequest): Observable<Draft> {
    return this.http.post<Draft>(`${this.baseUrl}/draft`, request);
  }
}
